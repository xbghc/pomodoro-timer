#include "flutter_window.h"
#include <flutter/standard_method_codec.h>
#include <flutter_windows.h>
#include <algorithm>
#include <cmath>
#include "flutter/generated_plugin_registrant.h"

namespace {
constexpr UINT_PTR kPoll = 101, kAnimation = 102;
using Value = flutter::EncodableValue;
}
FlutterWindow::FlutterWindow(const flutter::DartProject& project) : project_(project) {}
FlutterWindow::~FlutterWindow() = default;

bool FlutterWindow::OnCreate() {
  HWND window = GetHandle();
  SetWindowLongPtr(window, GWL_STYLE, WS_POPUP | WS_CLIPCHILDREN);
  SetWindowLongPtr(window, GWL_EXSTYLE, WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
  POINT point{};
  GetCursorPos(&point);
  Anchor(MonitorFromPoint(point, MONITOR_DEFAULTTOPRIMARY));
  configured_ = true;
  controller_ = std::make_unique<flutter::FlutterViewController>(width_, height_, project_);
  if (!controller_->engine() || !controller_->view()) return false;
  RegisterPlugins(controller_->engine());
  // The generated SetChildContent calls SetFocus. A hover panel must not do so.
  SetParent(controller_->view()->GetNativeWindow(), window);
  Place();
  CoCreateInstance(CLSID_VirtualDesktopManager, nullptr, CLSCTX_INPROC_SERVER,
                   IID_PPV_ARGS(desktops_.GetAddressOf()));
  channel_ = std::make_unique<flutter::MethodChannel<Value>>(
      controller_->engine()->messenger(), "pomodoro/desktop_shell",
      &flutter::StandardMethodCodec::GetInstance());
  channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    if (call.method_name() == "status") {
      result->Success(Snapshot());
    } else if (call.method_name() == "collapse") {
      hover_.Close(); Animate(false); result->Success(Snapshot());
    } else if (call.method_name() == "quit") {
      result->Success(); PostMessage(GetHandle(), WM_CLOSE, 0, 0);
    } else {
      result->NotImplemented();
    }
  });
  controller_->engine()->SetNextFrameCallback([this] {
    ready_ = true;
    if (FollowCurrentDesktop()) { Place(); ShowWindow(GetHandle(), SW_SHOWNOACTIVATE); }
    SetTimer(GetHandle(), kPoll, 80, nullptr);
    Publish();
  });
  controller_->ForceRedraw();
  return true;
}

void FlutterWindow::Anchor(HMONITOR monitor) {
  MONITORINFO info{}; info.cbSize = sizeof(info);
  if (!GetMonitorInfo(monitor, &info)) return;
  monitor_ = monitor;
  const double scale = FlutterDesktopGetDpiForMonitor(monitor) / 96.0;
  width_ = std::max(1, std::min(static_cast<int>(360 * scale), static_cast<int>(info.rcMonitor.right - info.rcMonitor.left)));
  height_ = std::max(1, std::min(static_cast<int>(320 * scale), static_cast<int>(info.rcWork.bottom - info.rcWork.top) - 32));
  strip_ = std::max(2, static_cast<int>(4 * scale));
  bounds_.right = info.rcMonitor.right;
  bounds_.left = bounds_.right - width_;
  bounds_.bottom = info.rcWork.bottom - 16;
  bounds_.top = bounds_.bottom - height_;
  reveal_ = hover_.expanded() ? width_ : strip_;
  target_ = reveal_;
}

void FlutterWindow::Place() {
  if (placing_ || !GetHandle()) return;
  placing_ = true;
  const int visible = std::clamp(static_cast<int>(std::round(reveal_)), strip_, width_);
  SetWindowPos(GetHandle(), HWND_TOPMOST, bounds_.right - visible, bounds_.top,
               visible, height_, SWP_NOACTIVATE | SWP_FRAMECHANGED);
  // Keep Flutter's surface fixed-size. The native parent clips hidden content;
  // there is no transparent full-width window intercepting other apps' input.
  if (controller_ && controller_->view()) {
    SetWindowPos(controller_->view()->GetNativeWindow(), nullptr, 0, 0, width_, height_,
                 SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  placing_ = false;
}

bool FlutterWindow::FollowCurrentDesktop() {
  BOOL current = FALSE;
  if (!desktops_) { desktop_status_ = "unavailable"; return false; }
  if (SUCCEEDED(desktops_->IsWindowOnCurrentVirtualDesktop(GetHandle(), &current)) && current) {
    desktop_status_ = "confirmed"; return true;
  }
  auto moveTo = [this](HWND candidate) {
    GUID desktop{}; BOOL current = FALSE;
    return candidate && candidate != GetHandle() &&
      SUCCEEDED(desktops_->IsWindowOnCurrentVirtualDesktop(candidate, &current)) && current &&
      SUCCEEDED(desktops_->GetWindowDesktopId(candidate, &desktop)) && !IsEqualGUID(desktop, GUID_NULL) &&
      SUCCEEDED(desktops_->MoveWindowToDesktop(GetHandle(), desktop));
  };
  bool moved = moveTo(GetForegroundWindow());
  if (!moved) {
    // Experimental empty-desktop fallback. This owned, invisible probe is newly
    // created on the current desktop. Never use private COM or switch desktops.
    HWND probe = CreateWindowEx(WS_EX_LAYERED | WS_EX_NOACTIVATE, L"STATIC",
      L"Pomodoro desktop probe", WS_POPUP, bounds_.right - 1, bounds_.top,
      1, 1, nullptr, nullptr, GetModuleHandle(nullptr), nullptr);
    if (probe) {
      SetLayeredWindowAttributes(probe, 0, 0, LWA_ALPHA);
      ShowWindow(probe, SW_SHOWNOACTIVATE);
      moved = moveTo(probe);
      DestroyWindow(probe);
    }
  }
  current = FALSE;
  const bool confirmed = moved &&
    SUCCEEDED(desktops_->IsWindowOnCurrentVirtualDesktop(GetHandle(), &current)) && current;
  desktop_status_ = confirmed ? "confirmed" : "unavailable";
  // Fail closed: do not activate an old desktop to make the panel visible.
  if (!confirmed) ShowWindow(GetHandle(), SW_HIDE);
  return confirmed;
}

void FlutterWindow::Poll() {
  POINT point{};
  if (!GetCursorPos(&point)) return;
  HMONITOR candidate = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
  MONITORINFO info{}; info.cbSize = sizeof(info);
  if (!GetMonitorInfo(candidate, &info)) return;
  const double scale = FlutterDesktopGetDpiForMonitor(candidate) / 96.0;
  const int bottom = info.rcWork.bottom - 16;
  const bool trigger = point.x >= info.rcMonitor.right - static_cast<int>(4 * scale) &&
    point.y >= bottom - std::max(1, std::min(static_cast<int>(320 * scale), static_cast<int>(info.rcWork.bottom - info.rcWork.top) - 32)) && point.y < bottom;
  if (!hover_.expanded() && trigger && candidate != monitor_) { Anchor(candidate); Place(); }
  RECT visible{}; GetWindowRect(GetHandle(), &visible);
  const bool inside = IsWindowVisible(GetHandle()) && PtInRect(&visible, point);
  const auto action = hover_.Update(GetTickCount64(), trigger, inside);
  if (action == HoverPolicy::Action::expand) {
    if (FollowCurrentDesktop()) {
      Place(); ShowWindow(GetHandle(), SW_SHOWNOACTIVATE); Animate(true);
    } else { hover_.Close(); Publish(); }
  } else if (action == HoverPolicy::Action::collapse) {
    Animate(false);
  }
}

void FlutterWindow::Animate(bool expanded) {
  from_ = reveal_; target_ = expanded ? width_ : strip_;
  animation_started_ = GetTickCount64();
  SetTimer(GetHandle(), kAnimation, 16, nullptr);
  Publish();
}
Value FlutterWindow::Snapshot() const {
  return Value(flutter::EncodableMap{
    {Value("platform"), Value("windows")},
    {Value("expanded"), Value(hover_.expanded())},
    {Value("desktop"), Value(desktop_status_)},
    {Value("prototype"), Value(true)},
  });
}
void FlutterWindow::Publish() {
  if (channel_) channel_->InvokeMethod("state", std::make_unique<Value>(Snapshot()));
}
void FlutterWindow::OnDestroy() {
  ready_ = false;
  if (GetHandle()) { KillTimer(GetHandle(), kPoll); KillTimer(GetHandle(), kAnimation); }
  channel_.reset(); controller_.reset(); desktops_.Reset();
}
LRESULT FlutterWindow::MessageHandler(HWND window, UINT message, WPARAM wp, LPARAM lp) noexcept {
  if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
  if (message == WM_ACTIVATE) return 0;
  if (message == WM_TIMER && ready_ && (wp == kPoll || wp == kAnimation)) {
    if (wp == kPoll) Poll();
    if (wp == kAnimation) {
      const double t = std::min(1.0, (GetTickCount64() - animation_started_) / 180.0);
      reveal_ = from_ + (target_ - from_) * (1 - std::pow(1 - t, 3));
      Place();
      if (t >= 1) KillTimer(window, kAnimation);
    }
    return 0;
  }
  if (message == WM_DISPLAYCHANGE && ready_) {
    hover_.Close(); KillTimer(window, kAnimation);
    POINT p{}; GetCursorPos(&p); Anchor(MonitorFromPoint(p, MONITOR_DEFAULTTOPRIMARY));
    Place(); Publish(); return 0;
  }
  if (message == WM_SIZE && configured_) { if (!placing_) Place(); return 0; }
  if (controller_) {
    auto handled = controller_->HandleTopLevelWindowProc(window, message, wp, lp);
    if (handled) return *handled;
  }
  if (message == WM_DPICHANGED && configured_) {
    if (!placing_) { Anchor(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST)); Place(); }
    return 0;
  }
  return Win32Window::MessageHandler(window, message, wp, lp);
}
