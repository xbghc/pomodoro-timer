import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

@immutable
class ShellState {
  const ShellState({this.platform = 'unknown', this.expanded = false,
    this.desktop = 'not-checked'});
  final String platform;
  final bool expanded;
  final String desktop;
  factory ShellState.decode(Object? value) {
    if (value is! Map || value['platform'] is! String ||
        value['expanded'] is! bool || value['desktop'] is! String ||
        value['prototype'] != true) {
      throw const FormatException('Invalid desktop shell response');
    }
    return ShellState(platform: value['platform'] as String,
      expanded: value['expanded'] as bool, desktop: value['desktop'] as String);
  }
}

// This bridge contains no timer or history state. Native callbacks cannot start
// or split activities. The prototype is intentionally not an Electron bridge.
class DesktopShell extends ValueNotifier<ShellState> {
  DesktopShell({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('pomodoro/desktop_shell'),
        super(const ShellState());
  final MethodChannel _channel;
  bool _closed = false;
  Future<void> start() async {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'state' && !_closed) {
        value = ShellState.decode(call.arguments);
      }
    });
    final initial = await _channel.invokeMethod<Object?>('status');
    if (!_closed) value = ShellState.decode(initial);
  }
  Future<void> collapse() async {
    final next = await _channel.invokeMethod<Object?>('collapse');
    if (!_closed) value = ShellState.decode(next);
  }
  Future<void> quit() => _channel.invokeMethod<void>('quit');
  @override
  void dispose() {
    _closed = true;
    _channel.setMethodCallHandler(null);
    super.dispose();
  }
}
