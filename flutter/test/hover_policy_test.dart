import 'package:flutter_test/flutter_test.dart';
import 'package:pomodoro_flutter/hover_policy.dart';

void main() {
  late HoverPolicy policy;
  setUp(() => policy = HoverPolicy());
  DrawerIntent sample(int time, {bool trigger = false, bool panel = false,
      bool visible = false, bool buttons = false, bool suspended = false,
      bool pinned = false, String display = 'one', int epoch = 0}) => policy.update(
        nowMs: time, display: display, epoch: epoch, inTrigger: trigger,
        inPanel: panel, visible: visible, buttonsDown: buttons,
        suspended: suspended, pinned: pinned,
      );

  test('edge must be hovered continuously for 180 ms', () {
    expect(sample(0, trigger: true), DrawerIntent.none);
    expect(sample(179, trigger: true), DrawerIntent.none);
    expect(sample(180, trigger: true), DrawerIntent.reveal);
  });
  test('passing through the edge does not reveal', () {
    sample(0, trigger: true); sample(100);
    expect(sample(200, trigger: true), DrawerIntent.none);
    expect(sample(380, trigger: true), DrawerIntent.reveal);
  });
  test('crossing from edge into panel preserves visibility', () {
    sample(0, visible: true, trigger: true);
    expect(sample(300, visible: true, panel: true), DrawerIntent.none);
    sample(400, visible: true);
    expect(sample(849, visible: true), DrawerIntent.none);
    expect(sample(850, visible: true), DrawerIntent.conceal);
  });
  test('returning to panel cancels delayed conceal', () {
    sample(0, visible: true); sample(400, visible: true, panel: true);
    expect(sample(700, visible: true), DrawerIntent.none);
    expect(sample(1150, visible: true), DrawerIntent.conceal);
  });
  test('dragging suppresses reveal and resets dwell', () {
    sample(0, trigger: true);
    expect(sample(200, trigger: true, buttons: true), DrawerIntent.none);
    expect(sample(250, trigger: true), DrawerIntent.none);
    expect(sample(430, trigger: true), DrawerIntent.reveal);
  });
  test('dragging within an open panel never conceals it', () {
    sample(0, visible: true);
    expect(sample(500, visible: true, buttons: true), DrawerIntent.none);
    expect(sample(550, visible: true), DrawerIntent.none);
  });
  test('explicit hide remains suppressed until cursor exits hot zone', () {
    policy.suppressUntilExit();
    sample(0, trigger: true);
    expect(sample(500, trigger: true), DrawerIntent.none);
    sample(600); sample(650, trigger: true);
    expect(sample(830, trigger: true), DrawerIntent.reveal);
  });
  test('changing monitor resets dwell', () {
    sample(0, trigger: true);
    expect(sample(200, trigger: true, display: 'two'), DrawerIntent.none);
    expect(sample(380, trigger: true, display: 'two'), DrawerIntent.reveal);
  });
  test('native display or space reset invalidates pending reveal', () {
    sample(0, trigger: true);
    expect(sample(200, trigger: true, epoch: 1), DrawerIntent.none);
  });
  test('missed heartbeats and clock rollback cannot instantly reveal', () {
    sample(0, trigger: true);
    expect(sample(3000, trigger: true), DrawerIntent.none);
    expect(sample(2000, trigger: true), DrawerIntent.none);
  });
  test('suspension resets pending edge dwell', () {
    sample(0, trigger: true);
    expect(sample(200, trigger: true, suspended: true), DrawerIntent.none);
    expect(sample(400, trigger: true), DrawerIntent.none);
  });
  test('pin prevents auto-hide but not explicit hide', () {
    sample(0, visible: true);
    expect(sample(900, visible: true, pinned: true), DrawerIntent.none);
    policy.suppressUntilExit();
    expect(sample(950, trigger: true), DrawerIntent.none);
  });
}
