import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'drawer_controller.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DrawerPrototype());
}

class DrawerPrototype extends StatefulWidget {
  const DrawerPrototype({super.key});
  @override
  State<DrawerPrototype> createState() => _DrawerPrototypeState();
}

class _DrawerPrototypeState extends State<DrawerPrototype> {
  final controller = DrawerController();
  @override
  void initState() { super.initState(); controller.start(); }
  @override
  void dispose() { controller.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Pomodoro drawer prototype',
    theme: ThemeData(useMaterial3: true, brightness: Brightness.light),
    darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
    home: ListenableBuilder(
      listenable: controller,
      builder: (context, _) => CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.escape): controller.conceal,
        },
        child: ClipRect(
          // Keep contents at their final width while the native window reveals
          // a progressively wider, clipped rectangle. No off-screen hit target.
          child: OverflowBox(
            alignment: Alignment.centerRight,
            minWidth: 360, maxWidth: 360,
            child: Scaffold(
              body: SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        const Expanded(child: Text('抽屉窗口原型', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600))),
                        IconButton(tooltip: '收起', onPressed: controller.conceal, icon: const Icon(Icons.chevron_right)),
                      ]),
                      const Text('Flutter + 原生窗口 · 不记录工作时间'),
                      const SizedBox(height: 16),
                      const Text('在屏幕工作区右边缘靠下的位置悬停展开。移开鼠标后自动收起。'),
                      const SizedBox(height: 16),
                      TextField(
                        onTap: controller.requestFocus,
                        decoration: const InputDecoration(border: OutlineInputBorder(), labelText: '点击此处测试键盘输入'),
                      ),
                      const SizedBox(height: 12),
                      Row(children: [
                        Expanded(child: OutlinedButton.icon(
                          onPressed: controller.togglePin,
                          icon: Icon(controller.pinned ? Icons.push_pin : Icons.push_pin_outlined),
                          label: Text(controller.pinned ? '已保持展开' : '保持展开'),
                        )),
                        const SizedBox(width: 8),
                        TextButton(onPressed: controller.quit, child: const Text('退出原型')),
                      ]),
                      Text('平台：${controller.platform}\n屏幕：${controller.observation['display'] ?? '-'}\n窗口焦点：${controller.observation['focused'] ?? false}'),
                      const SizedBox(height: 8),
                      const Text('跨桌面、全屏和多显示器行为仍需实机验收。', style: TextStyle(fontSize: 12)),
                      if (controller.error.isNotEmpty) Text(controller.error, key: const Key('native-error')),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
