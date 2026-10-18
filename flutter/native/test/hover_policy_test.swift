@main struct PolicyTests {
  static func main() {
    let p = HoverPolicy()
    precondition(p.update(now: 0, trigger: true, inside: false) == .none)
    precondition(p.update(now: 100, trigger: false, inside: false) == .none)
    precondition(p.update(now: 200, trigger: true, inside: false) == .none)
    precondition(p.update(now: 359, trigger: true, inside: false) == .none)
    precondition(p.update(now: 360, trigger: true, inside: false) == .expand)
    precondition(p.update(now: 400, trigger: false, inside: false) == .none)
    precondition(p.update(now: 799, trigger: false, inside: true) == .none)
    precondition(p.update(now: 800, trigger: false, inside: false) == .none)
    precondition(p.update(now: 1199, trigger: false, inside: false) == .none)
    precondition(p.update(now: 1200, trigger: false, inside: false) == .collapse)
    p.close()
    precondition(p.update(now: 2000, trigger: true, inside: false) == .none)
    precondition(p.update(now: 3000, trigger: true, inside: false) == .none)
    precondition(p.update(now: 3100, trigger: false, inside: false) == .none)
    precondition(p.update(now: 3200, trigger: true, inside: false) == .none)
    precondition(p.update(now: 3360, trigger: true, inside: false) == .expand)
    print("PASS: AppKit hover dwell, cancel, delayed close, manual-close rearm")
  }
}
