enum DrawerIntent { none, reveal, conceal }

/// No OS or Flutter dependency. All time values come from a monotonic clock.
class HoverPolicy {
  HoverPolicy({this.enterMs = 180, this.leaveMs = 450});
  final int enterMs;
  final int leaveMs;
  int? _enteredAt;
  int? _leftAt;
  int? _lastAt;
  String? _display;
  int? _epoch;
  bool _suppressed = false;

  void suppressUntilExit() {
    _suppressed = true;
    _enteredAt = null;
    _leftAt = null;
  }

  DrawerIntent update({
    required int nowMs,
    required String display,
    required int epoch,
    required bool inTrigger,
    required bool inPanel,
    required bool visible,
    required bool buttonsDown,
    bool suspended = false,
    bool pinned = false,
  }) {
    if (_display != display || _epoch != epoch ||
        (_lastAt != null && (nowMs < _lastAt! || nowMs - _lastAt! > 1000))) {
      _enteredAt = null;
      _leftAt = null;
    }
    _display = display;
    _epoch = epoch;
    _lastAt = nowMs;
    if (!inTrigger) _suppressed = false;
    if (suspended || buttonsDown) {
      _enteredAt = null;
      _leftAt = null;
      return DrawerIntent.none;
    }
    if (visible) {
      _enteredAt = null;
      if (pinned || inPanel || inTrigger) {
        _leftAt = null;
        return DrawerIntent.none;
      }
      _leftAt ??= nowMs;
      if (nowMs - _leftAt! >= leaveMs) {
        _leftAt = null;
        return DrawerIntent.conceal;
      }
    } else {
      _leftAt = null;
      if (!inTrigger || _suppressed) {
        _enteredAt = null;
        return DrawerIntent.none;
      }
      _enteredAt ??= nowMs;
      if (nowMs - _enteredAt! >= enterMs) return DrawerIntent.reveal;
    }
    return DrawerIntent.none;
  }
}
