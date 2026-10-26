# 第三方说明

本项目独立实现，未复制 ChatScreenExporter 源码或美术资源。仅参考其公开描述的截图、OCR、滚动导出这一类工作方式。自动滚动实现仍受显式白名单、校准及系统权限限制，真实多群轮巡尚未通过完整验收。

运行及构建所用组件：Electron（MIT 及其内含 Chromium 等组件的各自许可）、Tesseract.js / Tesseract.js-core（Apache-2.0）、Tesseract 语言数据包（保留 npm 包及上游数据附带的许可）、electron-builder（MIT）及其传递依赖。`npm run resources` 会从实际已安装依赖生成完整的许可证文件副本和清单，随安装包的 `resources/ocr/licenses` 一并交付。

原创部分的非商用限制不适用于第三方组件本身。第三方组件没有被重新授权。各版本锁定于 package-lock.json。正式发布必须保留 Electron 构建输出中的 LICENSE / LICENSES.chromium.html 等通知，并复核新增依赖许可。

0.4.1 Windows 原生组件使用固定版本 LLVM-MinGW 20261020（LLVM 23.1.4 / UCRT）构建。编译器不进入安装包；静态链接的 LLVM/libc++ 运行库采用 Apache-2.0 WITH LLVM-exception 等上游附带条款，MinGW-w64 运行库保留其各组成部分原许可。构建时复制工具链附带的 LICENSE.TXT、COPYING 与各 MinGW-w64 / winpthreads / winstorecompat 通知至 `resources/native/licenses/`。原创非商用限制不改变这些第三方许可。固定下载地址及 SHA-256 位于 `scripts/toolchain.cjs`。

参考资料：

- https://github.com/suyuwithoutPainkillers/ChatScreenExporter
- https://www.electronjs.org/docs/latest/api/desktop-capturer
- https://github.com/naptha/tesseract.js
- https://github.com/tesseract-ocr/tessdata
