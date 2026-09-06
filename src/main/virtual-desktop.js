// Windows 虚拟桌面：把自己的窗口拽到人当下所在的那个桌面
//
// Windows 把窗口钉死在它被创建时的虚拟桌面上，也不给应用「显示在所有桌面」的公开接口
// （Electron 的 setVisibleOnAllWorkspaces 在 Windows 上明确是空操作）。公开的
// IVirtualDesktopManager 只开放了一条路：把本进程的窗口挪到指定桌面。微软对这个接口的
// 定位恰好就是我们的场景 —— 让辅助窗口跟着人跑。
//
// 真正的 pin（任务视图右键「在所有桌面上显示此窗口」）只有未公开的 COM 接口能做，
// 那些接口的 GUID 随 Windows build 变，装个系统更新就可能静默失效，不值当。
//
// 没有桌面切换事件可订阅，只能轮询，挂在主进程本来就有的 500ms 广播上。
// 任何一步出错就整体降级成 no-op：虚拟桌面这点便利不值得让主流程陪葬。
'use strict';

const CLSID_VIRTUAL_DESKTOP_MANAGER = 'AA509086-5CA9-4C25-8F95-589D3C07B48A';
const IID_IVIRTUAL_DESKTOP_MANAGER = 'A5CD92FF-29BE-454C-8D04-D82879FB3F1B';
const CLSCTX_ALL = 23;
const COINIT_APARTMENTTHREADED = 2;
const PTR_SIZE = 8; // 只发 x64

// IVirtualDesktopManager 的 vtable 槽位。0~2 是继承自 IUnknown 的
// QueryInterface / AddRef / Release，接口自己的方法从 3 开始按声明顺序排。
const SLOT_IS_ON_CURRENT = 3;
const SLOT_GET_DESKTOP_ID = 4;
const SLOT_MOVE_TO_DESKTOP = 5;

// GUID 的内存布局是「前三段各自小端 + 后八字节按原序」，整串当大端写会错
function guidToBuffer(text) {
  const hex = text.replace(/[{}-]/g, '');
  if (hex.length !== 32) throw new Error(`GUID 格式不对: ${text}`);
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  buf.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  buf.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  buf.write(hex.slice(16), 8, 'hex');
  return buf;
}

let manager; // undefined = 还没试过；null = 用不了，别再试

function getManager() {
  if (manager !== undefined) return manager;
  manager = null;
  if (process.platform !== 'win32') return manager;
  try {
    manager = createManager();
  } catch (err) {
    console.error('虚拟桌面接口不可用，窗口会留在它被创建的桌面上:', err?.message || err);
  }
  return manager;
}

function createManager() {
  const koffi = require('koffi');
  const ole32 = koffi.load('ole32.dll');
  const user32 = koffi.load('user32.dll');

  const CoInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 init)');
  const CoCreateInstance = ole32.func(
    'int32 __stdcall CoCreateInstance(void *clsid, void *outer, uint32 ctx, void *iid, void *out)'
  );
  const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');

  // Electron 主线程早就初始化过 COM，这里多半拿到 S_FALSE 或 RPC_E_CHANGED_MODE，
  // 两者都不妨碍随后的 CoCreateInstance，所以不看返回值
  CoInitializeEx(null, COINIT_APARTMENTTHREADED);

  const out = Buffer.alloc(PTR_SIZE);
  const hr = CoCreateInstance(
    guidToBuffer(CLSID_VIRTUAL_DESKTOP_MANAGER),
    null,
    CLSCTX_ALL,
    guidToBuffer(IID_IVIRTUAL_DESKTOP_MANAGER),
    out
  );
  if (hr !== 0) throw new Error(`CoCreateInstance 返回 0x${(hr >>> 0).toString(16)}`);
  const self = out.readBigUInt64LE(0);
  if (!self) throw new Error('CoCreateInstance 给回了空指针');

  // COM 对象的头一个字段就是 vtable 指针，方法按槽位排在里面
  const vtable = koffi.decode(self, 'void *');
  const method = (slot) => koffi.decode(vtable, slot * PTR_SIZE, 'void *');

  // out 参数一律用 Buffer 传（koffi 传的是 Buffer 地址，正是 C 要的）；
  // 句柄这类「指针本身就是值」的参数传 BigInt
  const IsOnCurrent = koffi.proto(
    'int32 __stdcall IsOnCurrent(void *self, void *hwnd, void *onCurrent)'
  );
  const GetDesktopId = koffi.proto(
    'int32 __stdcall GetDesktopId(void *self, void *hwnd, void *desktopId)'
  );
  const MoveToDesktop = koffi.proto(
    'int32 __stdcall MoveToDesktop(void *self, void *hwnd, void *desktopId)'
  );

  const fnIsOnCurrent = method(SLOT_IS_ON_CURRENT);
  const fnGetDesktopId = method(SLOT_GET_DESKTOP_ID);
  const fnMoveToDesktop = method(SLOT_MOVE_TO_DESKTOP);

  const flag = Buffer.alloc(4);
  const desktopId = Buffer.alloc(16);

  return {
    // true / false / null（问不出来，当作「别动它」）
    isOnCurrentDesktop(hwnd) {
      if (koffi.call(fnIsOnCurrent, IsOnCurrent, self, hwnd, flag) !== 0) return null;
      return flag.readInt32LE(0) !== 0;
    },

    moveToCurrentDesktop(hwnd) {
      // 公开接口查不到「当前桌面的 GUID」，只能挑一个确定在当前桌面的窗口反问它，
      // 前台窗口就是最现成的那个
      const foreground = GetForegroundWindow();
      if (!foreground) return false;
      if (koffi.call(fnGetDesktopId, GetDesktopId, self, foreground, desktopId) !== 0) return false;
      // 全零 = 前台窗口自己就不属于某一个桌面（例如已被 pin 的窗口），这轮就别动了
      if (desktopId.every((b) => b === 0)) return false;
      return koffi.call(fnMoveToDesktop, MoveToDesktop, self, hwnd, desktopId) === 0;
    },
  };
}

// 把窗口拽到人当下所在的虚拟桌面。已经在那儿、或接口用不了，都什么都不做。
function followCurrentDesktop(win) {
  const vdm = getManager();
  if (!vdm || !win || win.isDestroyed()) return false;
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
    if (!hwnd) return false;
    // 只有明确「不在当前桌面」才动手；拿不准（null）时宁可不动
    if (vdm.isOnCurrentDesktop(hwnd) !== false) return false;
    return vdm.moveToCurrentDesktop(hwnd);
  } catch (err) {
    // 每 500ms 抛一次没有意义，出过一次就彻底关掉
    manager = null;
    console.error('挪窗口到当前虚拟桌面失败，后续不再尝试:', err?.message || err);
    return false;
  }
}

module.exports = { followCurrentDesktop, guidToBuffer };
