#ifndef RUNNER_FLUTTER_WINDOW_H_
#define RUNNER_FLUTTER_WINDOW_H_
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <flutter/method_channel.h>
#include <flutter/encodable_value.h>
#include <shobjidl.h>
#include <wrl/client.h>
#include <memory>
#include <string>
#include "win32_window.h"
#include "hover_policy.h"

class FlutterWindow : public Win32Window {
 public:
  explicit FlutterWindow(const flutter::DartProject& project);
  ~FlutterWindow() override;
 protected:
  bool OnCreate() override;
  void OnDestroy() override;
  LRESULT MessageHandler(HWND, UINT, WPARAM, LPARAM) noexcept override;
 private:
  void Anchor(HMONITOR monitor);
  void Place();
  void Poll();
  void Animate(bool expanded);
  bool FollowCurrentDesktop();
  void Publish();
  flutter::EncodableValue Snapshot() const;
  flutter::DartProject project_;
  std::unique_ptr<flutter::FlutterViewController> controller_;
  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel_;
  Microsoft::WRL::ComPtr<IVirtualDesktopManager> desktops_;
  HoverPolicy hover_;
  HMONITOR monitor_ = nullptr;
  RECT bounds_{};
  int width_ = 360, height_ = 320, strip_ = 4;
  double reveal_ = 4, from_ = 4, target_ = 4;
  uint64_t animation_started_ = 0;
  bool ready_ = false, placing_ = false, configured_ = false;
  std::string desktop_status_ = "not-checked";
};
#endif
