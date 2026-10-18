import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'hover_policy.dart';

class DrawerController extends ChangeNotifier {
  static const channel = MethodChannel('pomodoro/edge_drawer');
  final HoverPolicy policy = HoverPolicy();
  final Stopwatch clock = Stopwatch()..start();
  Timer? _timer;
  bool _busy = false;
  bool _disposed = false;
  bool pinned = false;
  String error = '';
  String platform = '';
  Map<String, dynamic> observation = {};
  int _retryAfter = 0;

  Future<void> start() async {
    try {
      final info = await channel.invokeMapMethod<String, dynamic>('bootstrap');
      if (_disposed) return;
      platform = info?['platform'] as String? ?? '';
      _timer = Timer.periodic(const Duration(milliseconds: 50), (_) => _poll());
      await _poll();
    } catch (e) {
      error = '$e';
      if (!_disposed) notifyListeners();
    }
  }

  Future<void> _poll() async {
    if (_busy || _disposed) return;
    _busy = true;
    try {
      final sample = await channel.invokeMapMethod<String, dynamic>('sample');
      if (_disposed || sample == null) return;
      observation = sample;
      error = sample['error'] as String? ?? '';
      final intent = policy.update(
        nowMs: clock.elapsedMilliseconds,
        display: '${sample['display']}',
        epoch: (sample['epoch'] as num?)?.toInt() ?? 0,
        inTrigger: sample['inTrigger'] == true,
        inPanel: sample['inPanel'] == true,
        visible: sample['visible'] == true,
        buttonsDown: sample['buttonsDown'] == true,
        suspended: sample['suspended'] == true,
        pinned: pinned,
      );
      if (intent == DrawerIntent.reveal && clock.elapsedMilliseconds >= _retryAfter) {
        final shown = await channel.invokeMethod<bool>('reveal') ?? false;
        if (!shown) _retryAfter = clock.elapsedMilliseconds + 250;
      } else if (intent == DrawerIntent.conceal) {
        await channel.invokeMethod<void>('conceal');
      }
    } catch (e) {
      error = '$e';
      _retryAfter = clock.elapsedMilliseconds + 1000;
    } finally {
      _busy = false;
      if (!_disposed) notifyListeners();
    }
  }

  void togglePin() { pinned = !pinned; notifyListeners(); }

  Future<void> conceal() async {
    pinned = false;
    policy.suppressUntilExit();
    await _invoke('conceal');
  }

  Future<void> requestFocus() => _invoke('requestFocus');
  Future<void> quit() => _invoke('quit');

  Future<void> _invoke(String method) async {
    try { await channel.invokeMethod<void>(method); }
    catch (e) { error = '$e'; if (!_disposed) notifyListeners(); }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
