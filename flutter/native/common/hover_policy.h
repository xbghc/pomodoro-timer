#pragma once
#include <cstdint>
#include <optional>

// Monotonic milliseconds only. No GUI, framework or wall-clock dependency.
class HoverPolicy {
 public:
  enum class Action { none, expand, collapse };
  Action Update(uint64_t now, bool trigger, bool inside) {
    if (blocked_) {
      if (!trigger) blocked_ = false;
      return Action::none;
    }
    if (!expanded_) {
      if (!trigger) { entered_.reset(); return Action::none; }
      if (!entered_) entered_ = now;
      if (now - *entered_ < 160) return Action::none;
      expanded_ = true;
      entered_.reset();
      return Action::expand;
    }
    if (inside || trigger) { left_.reset(); return Action::none; }
    if (!left_) left_ = now;
    if (now - *left_ < 400) return Action::none;
    expanded_ = false;
    left_.reset();
    return Action::collapse;
  }
  void Close() {
    expanded_ = false;
    blocked_ = true; // Manual close/failure requires leaving the trigger first.
    entered_.reset();
    left_.reset();
  }
  bool expanded() const { return expanded_; }
 private:
  bool expanded_ = false;
  bool blocked_ = false;
  std::optional<uint64_t> entered_, left_;
};
