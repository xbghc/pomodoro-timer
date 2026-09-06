'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { guidToBuffer, followCurrentDesktop } = require('../src/main/virtual-desktop.js');

// GUID 的内存布局是「前三段各自小端 + 后八字节按原序」。写错字节序不会报错，
// 只会安静地拿不到 COM 对象，所以拿实际用到的两个 GUID 钉死。
test('GUID 按 COM 的混合字节序打包', () => {
  assert.deepEqual(
    [...guidToBuffer('AA509086-5CA9-4C25-8F95-589D3C07B48A')],
    [0x86, 0x90, 0x50, 0xaa, 0xa9, 0x5c, 0x25, 0x4c, 0x8f, 0x95, 0x58, 0x9d, 0x3c, 0x07, 0xb4, 0x8a],
    'CLSID_VirtualDesktopManager'
  );
  assert.deepEqual(
    [...guidToBuffer('A5CD92FF-29BE-454C-8D04-D82879FB3F1B')],
    [0xff, 0x92, 0xcd, 0xa5, 0xbe, 0x29, 0x4c, 0x45, 0x8d, 0x04, 0xd8, 0x28, 0x79, 0xfb, 0x3f, 0x1b],
    'IID_IVirtualDesktopManager'
  );
});

test('带花括号的写法同样接受，格式不对则抛错', () => {
  assert.deepEqual(
    [...guidToBuffer('{AA509086-5CA9-4C25-8F95-589D3C07B48A}')],
    [...guidToBuffer('AA509086-5CA9-4C25-8F95-589D3C07B48A')]
  );
  assert.throws(() => guidToBuffer('not-a-guid'), /GUID 格式不对/);
});

// 这个模块只在 Windows 上有事可做，其余平台必须是彻底的 no-op：
// 冒烟测试跑在 Linux 上，它一抛异常整条广播链就断了
test('非 Windows 平台是安全的 no-op，且不碰 koffi', { skip: process.platform === 'win32' }, () => {
  const fakeWindow = {
    isDestroyed: () => false,
    getNativeWindowHandle() {
      throw new Error('非 Windows 平台不该走到取句柄这一步');
    },
  };
  assert.equal(followCurrentDesktop(fakeWindow), false);
  assert.equal(followCurrentDesktop(null), false);
  assert.equal(followCurrentDesktop({ isDestroyed: () => true }), false);
});
