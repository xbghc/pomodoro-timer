#include "../common/hover_policy.h"
#include <cassert>
#include <iostream>
int main() {
  using A = HoverPolicy::Action;
  HoverPolicy p;
  assert(p.Update(0, true, false) == A::none);
  assert(p.Update(100, false, false) == A::none); // Short crossing is not a hover.
  assert(p.Update(200, true, false) == A::none);
  assert(p.Update(359, true, false) == A::none);
  assert(p.Update(360, true, false) == A::expand);
  assert(p.Update(400, false, false) == A::none);
  assert(p.Update(799, false, true) == A::none); // Returning cancels close.
  assert(p.Update(800, false, false) == A::none);
  assert(p.Update(1199, false, false) == A::none);
  assert(p.Update(1200, false, false) == A::collapse);
  p.Close();
  assert(p.Update(2000, true, false) == A::none);
  assert(p.Update(3000, true, false) == A::none);
  assert(p.Update(3100, false, false) == A::none);
  assert(p.Update(3200, true, false) == A::none);
  assert(p.Update(3360, true, false) == A::expand);
  std::cout << "PASS: Win32 hover dwell, cancel, delayed close, manual-close rearm\n";
}
