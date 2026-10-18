#pragma once

#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shellscalingapi.h>
#include <shobjidl.h>
#include <wrl/client.h>
#include <flutter/flutter_engine.h>
#include <flutter/method_channel.h>
#include <flutter/standard_method_codec.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>

// The hidden Flutter runner owns the engine. This class owns only native window
// behavior and the narrow channel; it never touches activity data or other apps.
class EdgeDrawer {
 public:
  using Value = flutter::EncodableValue;
  using Map = flutter::EncodableMap;
  using Result = flutter::MethodResult<Value>;

  EdgeDrawer(HWND window, flutter::FlutterEngine* engine) : window_(window) {
    auto style = GetWindowLongPtrW(window_, GWL_STYLE);
    SetWindowLongPtrW(window_, GWL_STYLE,
        (style & ~(WS_OVERLAPPEDWINDOW | WS_VISIBLE)) | WS_POPUP | WS_CLIPCHILDREN);
    SetWindowLongPtrW(window_, GWL_EXSTYLE,
        (GetWindowLongPtrW(window_, GWL_EXSTYLE) & ~WS_EX_APPWINDOW) |
        WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
    SetWindowPos(window_, nullptr, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    ShowWindow(window_, SW_HIDE);
    CoCreateInstance(CLSID_VirtualDesktopManager, nullptr, CLSCTX_INPROC_SERVER,
                    IID_PPV_ARGS(desktops_.GetAddressOf()));
    taskbar_created_ = RegisterWindowMessageW(L"TaskbarCreated");
    AddTray();
    channel_ = std::make_unique<flutter::MethodChannel<Value>>(
        engine->messenger(), "pomodoro/edge_drawer",
        &flutter::StandardMethodCodec::GetInstance());
    channel_->SetMethodCallHandler([this](const auto& call, std::unique_ptr<Result> result) {
      const auto& method = call.method_name();
      if (method == "bootstrap") {
        result->Success(Value(Map{{Value("platform"), Value("Windows / Win32")}}));
      } else if (method == "sample") {
        result->Success(Sample());
      } else if (method == "reveal") {
        result->Success(Value(Reveal()));
      } else if (method == "conceal") {
        Conceal(false); result->Success();
      } else if (method == "requestFocus") {
        if (visible_) {
          manual_focus_ = true;
          SetWindowLongPtrW(window_, GWL_EXSTYLE,
              GetWindowLongPtrW(window_, GWL_EXSTYLE) & ~WS_EX_NOACTIVATE);
          SetForegroundWindow(window_);
        }
        result->Success();
      } else if (method == "quit") {
        result->Success(); PostQuitMessage(0);
      } else {
        result->NotImplemented();
      }
    });
  }

  ~EdgeDrawer() {
    channel_->SetMethodCallHandler(nullptr);
    KillTimer(window_, kAnimationTimer);
    DestroyProbe();
    Shell_NotifyIconW(NIM_DELETE, &tray_);
  }
  EdgeDrawer(const EdgeDrawer&) = delete;
  EdgeDrawer& operator=(const EdgeDrawer&) = delete;

  std::optional<LRESULT> HandleMessage(UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == taskbar_created_) { AddTray(); return 0; }
    if (message == kTrayMessage) {
      const UINT event = LOWORD(lparam);
      if (event == WM_LBUTTONUP || event == NIN_SELECT || event == NIN_KEYSELECT) Reveal();
      if (event == WM_RBUTTONUP || event == WM_CONTEXTMENU) {
        POINT point{}; GetCursorPos(&point);
        HMENU menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, 1, L"Show drawer prototype");
        AppendMenuW(menu, MF_STRING, 2, L"Hide drawer");
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(menu, MF_STRING, 3, L"Quit prototype");
        SetForegroundWindow(window_); // Explicit tray interaction, never hover.
        const int action = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
                                         point.x, point.y, 0, window_, nullptr);
        DestroyMenu(menu);
        if (action == 1) Reveal();
        if (action == 2) Conceal(true);
        if (action == 3) PostQuitMessage(0);
      }
      return 0;
    }
    if (message == WM_TIMER && wparam == kAnimationTimer) { AnimateFrame(); return 0; }
    if (message == WM_MOUSEACTIVATE && !manual_focus_) return MA_NOACTIVATE;
    if (message == WM_CLOSE) { Conceal(true); return 0; }
    if (message == WM_DISPLAYCHANGE) { ++epoch_; Conceal(true); }
    if (message == WM_POWERBROADCAST) {
      if (wparam == PBT_APMSUSPEND) { suspended_ = true; ++epoch_; Conceal(true); }
      if (wparam == PBT_APMRESUMEAUTOMATIC || wparam == PBT_APMRESUMESUSPEND) {
        suspended_ = false; ++epoch_;
      }
    }
    return std::nullopt;
  }

 private:
  static constexpr UINT kTrayMessage = WM_APP + 71;
  static constexpr UINT_PTR kAnimationTimer = 0x504f;
  HWND window_;
  HWND probe_ = nullptr;
  ULONGLONG probe_started_ = 0;
  Microsoft::WRL::ComPtr<IVirtualDesktopManager> desktops_;
  std::unique_ptr<flutter::MethodChannel<Value>> channel_;
  NOTIFYICONDATAW tray_{};
  UINT taskbar_created_ = 0;
  bool visible_ = false, suspended_ = false, manual_focus_ = false;
  bool animating_ = false, opening_ = false, desktop_verified_ = false;
  int epoch_ = 0, from_width_ = 1;
  ULONGLONG animation_started_ = 0;
  RECT target_{};
  std::string error_;

  void AddTray() {
    tray_ = {};
    tray_.cbSize = sizeof(tray_); tray_.hWnd = window_; tray_.uID = 1;
    tray_.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    tray_.uCallbackMessage = kTrayMessage;
    tray_.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wcscpy_s(tray_.szTip, L"Flutter native drawer prototype");
    Shell_NotifyIconW(NIM_ADD, &tray_);
    tray_.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &tray_);
  }
  static RECT WorkArea(HMONITOR monitor) {
    MONITORINFO info{}; info.cbSize = sizeof(info);
    GetMonitorInfoW(monitor, &info); return info.rcWork;
  }
  static double Scale(HMONITOR monitor) {
    UINT x = 96, y = 96;
    if (FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &x, &y))) x = 96;
    return static_cast<double>(x) / 96.0;
  }
  bool IsCurrent(HWND window) {
    BOOL current = FALSE;
    return desktops_ && SUCCEEDED(desktops_->IsWindowOnCurrentVirtualDesktop(window, &current)) && current;
  }
  bool DesktopId(HWND window, GUID* id) {
    if (!window || window == window_ || !IsCurrent(window)) return false;
    return SUCCEEDED(desktops_->GetWindowDesktopId(window, id)) && !IsEqualGUID(*id, GUID_NULL);
  }
  void DestroyProbe() {
    if (probe_) { DestroyWindow(probe_); probe_ = nullptr; }
  }
  bool PrepareDesktop() {
    desktop_verified_ = false;
    if (!desktops_) { error_ = "Public virtual-desktop manager unavailable; reveal not verified."; return false; }
    if (IsCurrent(window_)) { DestroyProbe(); desktop_verified_ = true; error_.clear(); return true; }
    GUID target{};
    bool found = DesktopId(GetAncestor(GetForegroundWindow(), GA_ROOT), &target);
    struct Search { EdgeDrawer* drawer; GUID id{}; bool found = false; } search{this};
    if (!found) {
      EnumWindows([](HWND hwnd, LPARAM data) -> BOOL {
        auto* s = reinterpret_cast<Search*>(data);
        if (!IsWindowVisible(hwnd)) return TRUE;
        DWORD cloaked = 0;
        if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) return TRUE;
        if (s->drawer->DesktopId(hwnd, &s->id)) { s->found = true; return FALSE; }
        return TRUE;
      }, reinterpret_cast<LPARAM>(&search));
      if (search.found) { target = search.id; found = true; }
    }
    if (!found) {
      // Explicit feasibility experiment for empty desktops: let Explorer assign
      // a newly created application-owned top-level probe to the current desktop.
      // This is NOT a documented guarantee. Never switch desktops as a fallback.
      if (!probe_) {
        POINT cursor{}; GetCursorPos(&cursor);
        probe_ = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
            L"STATIC", L"Pomodoro desktop probe", WS_POPUP,
            cursor.x, cursor.y, 1, 1, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
        if (!probe_) { error_ = "Could not create desktop probe."; return false; }
        SetLayeredWindowAttributes(probe_, 0, 0, LWA_ALPHA);
        ShowWindow(probe_, SW_SHOWNOACTIVATE);
        probe_started_ = GetTickCount64();
        error_ = "Waiting for Explorer to assign the desktop probe.";
        return false; // The next serialized sample retries; never block the UI thread.
      }
      found = DesktopId(probe_, &target);
      if (!found) {
        if (GetTickCount64() - probe_started_ > 1500) {
          DestroyProbe(); error_ = "Empty-desktop handoff could not be verified. Hardware validation required.";
        }
        return false;
      }
    }
    const HRESULT moved = desktops_->MoveWindowToDesktop(window_, target);
    DestroyProbe();
    desktop_verified_ = SUCCEEDED(moved) && IsCurrent(window_);
    error_ = desktop_verified_ ? "" : "Window move failed or current-desktop membership was not verified.";
    return desktop_verified_;
  }
  Value Sample() {
    POINT cursor{}; GetCursorPos(&cursor);
    const HMONITOR monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
    const RECT work = WorkArea(monitor); const double scale = Scale(monitor);
    const RECT trigger{work.right - static_cast<LONG>(std::ceil(4 * scale)),
                       work.bottom - static_cast<LONG>(std::ceil(96 * scale)),
                       work.right, work.bottom - static_cast<LONG>(std::ceil(24 * scale))};
    if (visible_ && !IsCurrent(window_)) { ++epoch_; Conceal(true); }
    RECT panel{}; GetWindowRect(window_, &panel);
    const bool buttons = ((GetAsyncKeyState(VK_LBUTTON) | GetAsyncKeyState(VK_RBUTTON) |
                           GetAsyncKeyState(VK_MBUTTON)) & 0x8000) != 0;
    if (probe_ && !PtInRect(&trigger, cursor)) DestroyProbe();
    return Value(Map{
      {Value("display"), Value(static_cast<int64_t>(reinterpret_cast<intptr_t>(monitor)))},
      {Value("epoch"), Value(static_cast<int64_t>(epoch_))},
      {Value("inTrigger"), Value(PtInRect(&trigger, cursor) != FALSE)},
      {Value("inPanel"), Value(visible_ && PtInRect(&panel, cursor) != FALSE)},
      {Value("visible"), Value(visible_ && IsWindowVisible(window_) != FALSE)},
      {Value("focused"), Value(GetForegroundWindow() == window_)},
      {Value("buttonsDown"), Value(buttons)},
      {Value("suspended"), Value(suspended_)},
      {Value("desktopVerified"), Value(desktop_verified_)},
      {Value("error"), Value(error_)}
    });
  }
  bool Reveal() {
    if (suspended_) return false;
    if (visible_ && IsCurrent(window_)) return true;
    if (!PrepareDesktop()) return false;
    POINT cursor{}; GetCursorPos(&cursor);
    const HMONITOR monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
    const RECT work = WorkArea(monitor); const double scale = Scale(monitor);
    const int width = (std::min)(static_cast<int>(360 * scale), static_cast<int>(work.right - work.left));
    const int bottom = work.bottom - static_cast<int>(24 * scale);
    const int height = (std::min)(static_cast<int>(420 * scale), bottom - static_cast<int>(work.top));
    if (width < 1 || height < 1) { error_ = "Monitor work area is too small."; return false; }
    target_ = RECT{work.right - width, bottom - height, work.right, bottom};
    manual_focus_ = false;
    SetWindowLongPtrW(window_, GWL_EXSTYLE, GetWindowLongPtrW(window_, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
    Place(1);
    ShowWindow(window_, SW_SHOWNOACTIVATE);
    visible_ = true;
    StartAnimation(true);
    return true;
  }
  void Place(int width) {
    SetWindowPos(window_, HWND_TOPMOST, target_.right - width, target_.top,
                 width, target_.bottom - target_.top, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
  }
  void HideNow() {
    KillTimer(window_, kAnimationTimer); animating_ = false;
    ShowWindow(window_, SW_HIDE); visible_ = false; manual_focus_ = false;
    SetWindowLongPtrW(window_, GWL_EXSTYLE, GetWindowLongPtrW(window_, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
  }
  void Conceal(bool immediate) {
    DestroyProbe();
    if (immediate || !visible_) { HideNow(); return; }
    if (!animating_ || opening_) StartAnimation(false);
  }
  void StartAnimation(bool opening) {
    RECT rect{}; GetWindowRect(window_, &rect);
    from_width_ = static_cast<int>(rect.right - rect.left);
    opening_ = opening; animation_started_ = GetTickCount64(); animating_ = true;
    BOOL enabled = TRUE;
    SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &enabled, 0);
    if (!enabled) {
      if (opening_) Place(target_.right - target_.left); else HideNow();
      animating_ = false; return;
    }
    SetTimer(window_, kAnimationTimer, 16, nullptr);
  }
  void AnimateFrame() {
    if (!animating_) return;
    const double progress = (std::min)(1.0, static_cast<double>(GetTickCount64() - animation_started_) / 160.0);
    const double eased = 1.0 - std::pow(1.0 - progress, 3.0);
    const int end_width = opening_ ? target_.right - target_.left : 1;
    Place((std::max)(1, static_cast<int>(std::lround(from_width_ + (end_width - from_width_) * eased))));
    if (progress >= 1.0) {
      KillTimer(window_, kAnimationTimer); animating_ = false;
      if (!opening_) HideNow();
    }
  }
};
