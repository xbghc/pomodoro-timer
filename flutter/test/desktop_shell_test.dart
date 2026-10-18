import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pomodoro_shell_probe/desktop_shell.dart';
import 'package:pomodoro_shell_probe/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('pomodoro/desktop_shell');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final state = <String, Object>{'platform': 'test', 'expanded': false,
    'desktop': 'not-checked', 'prototype': true};
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('the bridge reads the native state and sends an explicit collapse', () async {
    final calls = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method); return state;
    });
    final shell = DesktopShell();
    addTearDown(shell.dispose);
    await shell.start();
    expect(shell.value.platform, 'test');
    await shell.collapse();
    expect(calls, ['status', 'collapse']);
  });
  test('native failures are not replaced by a simulated success', () async {
    messenger.setMockMethodCallHandler(channel, (_) async {
      throw PlatformException(code: 'unavailable');
    });
    final shell = DesktopShell();
    addTearDown(shell.dispose);
    await expectLater(shell.start(), throwsA(isA<PlatformException>()));
  });
  test('malformed and non-prototype responses are rejected', () {
    expect(() => ShellState.decode(null), throwsFormatException);
    expect(() => ShellState.decode({...state, 'prototype': false}), throwsFormatException);
    expect(() => ShellState.decode({...state, 'expanded': 1}), throwsFormatException);
  });
  testWidgets('the probe labels itself and accepts a pointer click', (tester) async {
    messenger.setMockMethodCallHandler(channel, (_) async => state);
    await tester.pumpWidget(const ShellProbe());
    await tester.pumpAndSettle();
    expect(find.text('贴边抽屉 · 技术原型'), findsOneWidget);
    await tester.tap(find.text('测试点击（不抢焦点）'));
    await tester.pump();
    expect(find.text('点击次数：1'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}

