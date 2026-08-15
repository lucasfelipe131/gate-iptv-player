# QRCode for JavaScript (vendored)

This directory contains the QR matrix generator by Kazuhiko Arase, vendored
from the `qrcode-terminal` package. It is distributed under the MIT License;
see `LICENSE`.

The local copy only changes CommonJS file extensions and internal `require`
paths so it can coexist with this project's ESM package configuration. The
application converts the matrix to an SVG data URL locally and never sends QR
payloads to a third-party rendering service.
