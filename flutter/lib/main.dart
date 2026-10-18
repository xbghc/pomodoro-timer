import 'package:flutter/material.dart';
import 'desktop_shell.dart';

void main() => runApp(const ShellProbe());

class ShellProbe extends StatelessWidget {
  const ShellProbe({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
    home: const ProbePanel(),
  );
}

class ProbePanel extends StatefulWidget {
  const ProbePanel({super.key});
  @override
  State<ProbePanel> createState() => _ProbePanelState();
}

class _ProbePanelState extends State<ProbePanel> {
  final shell = DesktopShell();
  int clicks = 0;
  String? failure;
  @override
  void initState() { super.initState(); perform(shell.start); }
  Future<void> perform(Future<void> Function() action) async {
    try { await action(); }
    catch (error) { if (mounted) setState(() => failure = '$error'); }
  }
  @override
  void dispose() { shell.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Scaffold(
    body: DecoratedBox(
      decoration: BoxDecoration(border: Border(left: BorderSide(
        color: Theme.of(context).colorScheme.primary, width: 4))),
      child: SizedBox.expand(child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 16, 16),
        child: SingleChildScrollView(child: ValueListenableBuilder<ShellState>(
          valueListenable: shell,
          builder: (context, state, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('贴边抽屉 · 技术原型', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              const Text('只验证原生窗口行为；尚未接入番茄钟计时或历史记录。'),
              const SizedBox(height: 12),
              Text('平台：${state.platform}'),
              Text('桌面状态：${state.desktop}'),
              Text('点击次数：$clicks'),
              if (failure != null) Text(failure!, style: TextStyle(
                color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 12),
              FilledButton(onPressed: () => setState(() => clicks++),
                child: const Text('测试点击（不抢焦点）')),
              Row(children: [
                TextButton(onPressed: () => perform(shell.collapse), child: const Text('收起')),
                TextButton(onPressed: () => perform(shell.quit), child: const Text('退出原型')),
              ]),
            ],
          ),
        )),
      )),
    ),
  );
}
