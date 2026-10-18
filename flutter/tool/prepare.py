"""Generate disposable desktop hosts with the pinned Flutter SDK, then install native overrides.
Run from any directory: python tool/prepare.py. No Electron or user data is touched.
"""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '3.47.7'

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Flutter runner template changed; refusing a partial patch: ' + old)
    return text.replace(old, new, 1)

def prepare():
    flutter = shutil.which('flutter')
    if not flutter:
        raise SystemExit('Install Flutter ' + VERSION + ' and put flutter on PATH.')
    version = json.loads(subprocess.check_output([flutter, '--version', '--machine'], text=True))
    if version['frameworkVersion'] != VERSION:
        raise SystemExit('Expected Flutter ' + VERSION + ', found ' + version['frameworkVersion'])
    if any((ROOT / platform).exists() for platform in ('windows', 'macos')):
        raise SystemExit('Hosts already exist. Delete only flutter/windows and flutter/macos to regenerate; custom sources are in native/.')
    with tempfile.TemporaryDirectory(prefix='pomodoro-flutter-') as tmp:
        host = Path(tmp) / 'host'
        subprocess.run([flutter, 'create', '--platforms=windows,macos', '--org=io.github.xbghc',
                        '--project-name=pomodoro_flutter', '--no-pub', str(host)], check=True)
        win = host / 'windows' / 'runner'
        header = (win / 'flutter_window.h').read_text()
        header = replace_once(header, 'class FlutterWindow : public Win32Window', 'class EdgeDrawer;\n\nclass FlutterWindow : public Win32Window')
        header = replace_once(header, ' private:', ' private:\n  std::unique_ptr<EdgeDrawer> drawer_;')
        (win / 'flutter_window.h').write_text(header)
        source = (win / 'flutter_window.cpp').read_text()
        source = replace_once(source, '#include "flutter_window.h"', '#include "flutter_window.h"\n#include "edge_drawer.h"')
        source = replace_once(source, '  SetChildContent(flutter_controller_->view()->GetNativeWindow());',
                              '  SetChildContent(flutter_controller_->view()->GetNativeWindow());\n  drawer_ = std::make_unique<EdgeDrawer>(GetHandle(), flutter_controller_->engine());')
        source = replace_once(source, '    this->Show();', '    // Native drawer exclusively owns visibility and focus. No startup flash.')
        source = replace_once(source, 'void FlutterWindow::OnDestroy() {', 'void FlutterWindow::OnDestroy() {\n  drawer_.reset();')
        source = replace_once(source, '  // Give Flutter, including plugins, an opportunity to handle window messages.',
                              '  if (drawer_) {\n    auto handled = drawer_->HandleMessage(message, wparam, lparam);\n    if (handled) return *handled;\n  }\n  // Give Flutter, including plugins, an opportunity to handle window messages.')
        (win / 'flutter_window.cpp').write_text(source)
        shutil.copyfile(ROOT / 'native/windows/edge_drawer.h', win / 'edge_drawer.h')
        cmake = win / 'CMakeLists.txt'
        cmake.write_text(cmake.read_text() + '\ntarget_link_libraries(${BINARY_NAME} PRIVATE dwmapi shcore shell32 ole32)\n')
        mac = host / 'macos' / 'Runner'
        shutil.copyfile(ROOT / 'native/macos/MainFlutterWindow.swift', mac / 'MainFlutterWindow.swift')
        delegate = mac / 'AppDelegate.swift'
        text = delegate.read_text()
        text = replace_once(text, 'override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {\n    return true',
                             'override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {\n    return false')
        delegate.write_text(text)
        xib = mac / 'Base.lproj' / 'MainMenu.xib'
        text = xib.read_text().replace('visibleAtLaunch="YES"', 'visibleAtLaunch="NO"')
        xib.write_text(text)
        # Copy only after every template assertion has passed.
        for platform in ('windows', 'macos'):
            shutil.copytree(host / platform, ROOT / platform)
    print('Prepared native hosts. Run flutter pub get, then flutter run -d windows or -d macos.')

if __name__ == '__main__':
    prepare()
