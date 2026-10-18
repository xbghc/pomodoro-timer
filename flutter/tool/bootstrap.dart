import 'dart:io';

// Run with `dart tool/bootstrap.dart` from flutter/. Generated runner files are
// disposable. Canonical native implementations live under native/.
Future<void> main() async {
  if (!File('pubspec.yaml').existsSync() || !Directory('native').existsSync()) {
    throw StateError('Run this script from the flutter/ directory.');
  }
  for (final platform in ['windows', 'macos']) {
    if (Directory(platform).existsSync() &&
        !File('$platform/.shell-probe-generated').existsSync()) {
      throw StateError('Refusing to overwrite an unowned $platform runner.');
    }
  }
  final temp = Directory.systemTemp.createTempSync('pomodoro-flutter-');
  try {
    final child = await Process.start('flutter', [
      'create', '--platforms=windows,macos', '--no-pub',
      '--project-name=pomodoro_shell_probe', '--org=dev.xbghc', '${temp.path}/app',
    ], runInShell: Platform.isWindows, mode: ProcessStartMode.inheritStdio);
    final code = await child.exitCode;
    if (code != 0) throw ProcessException('flutter', ['create'], 'Runner generation failed', code);
    for (final platform in ['windows', 'macos']) {
      if (!Directory(platform).existsSync()) {
        copyDirectory(Directory('${temp.path}/app/$platform'), Directory(platform));
        File('$platform/.shell-probe-generated').writeAsStringSync('Generated; edit native/ instead.\n');
      }
    }
    File('${temp.path}/app/.metadata').copySync('.metadata');
  } finally { temp.deleteSync(recursive: true); }
  for (final file in ['flutter_window.cpp', 'flutter_window.h']) {
    File('native/windows/$file').copySync('windows/runner/$file');
  }
  File('native/common/hover_policy.h').copySync('windows/runner/hover_policy.h');
  final cmake = File('windows/runner/CMakeLists.txt');
  const link = '\ntarget_link_libraries(\${BINARY_NAME} PRIVATE ole32 uuid)\n';
  if (!cmake.readAsStringSync().contains(link.trim())) {
    cmake.writeAsStringSync(link, mode: FileMode.append);
  }
  File('macos/Runner/MainFlutterWindow.swift').writeAsStringSync(
    '${File('native/macos/MainFlutterWindow.swift').readAsStringSync()}\n'
    '${File('native/macos/HoverPolicy.swift').readAsStringSync()}');
  final nib = File('macos/Runner/Base.lproj/MainMenu.xib');
  nib.writeAsStringSync(nib.readAsStringSync().replaceAll('visibleAtLaunch="YES"', 'visibleAtLaunch="NO"'));
  stdout.writeln('Native shell runners generated. Next: flutter pub get; flutter run -d windows|macos');
}
void copyDirectory(Directory from, Directory to) {
  to.createSync(recursive: true);
  for (final entity in from.listSync()) {
    final name = entity.uri.pathSegments.where((part) => part.isNotEmpty).last;
    if (entity is Directory) {
      copyDirectory(entity, Directory('${to.path}/$name'));
    } else if (entity is File) {
      entity.copySync('${to.path}/$name');
    } else {
      throw StateError('Unexpected generated entry: ${entity.path}');
    }
  }
}
