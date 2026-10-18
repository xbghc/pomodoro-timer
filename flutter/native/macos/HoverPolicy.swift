// Time is monotonic milliseconds; identical policy to the Win32 implementation.
final class HoverPolicy {
  enum Action { case none, expand, collapse }
  private(set) var expanded = false
  private var blocked = false
  private var entered: Double?
  private var left: Double?
  func update(now: Double, trigger: Bool, inside: Bool) -> Action {
    if blocked {
      if !trigger { blocked = false }
      return .none
    }
    if !expanded {
      guard trigger else { entered = nil; return .none }
      if entered == nil { entered = now }
      guard now - entered! >= 160 else { return .none }
      expanded = true; entered = nil
      return .expand
    }
    if inside || trigger { left = nil; return .none }
    if left == nil { left = now }
    guard now - left! >= 400 else { return .none }
    expanded = false; left = nil
    return .collapse
  }
  func close() {
    expanded = false; blocked = true; entered = nil; left = nil
  }
}
