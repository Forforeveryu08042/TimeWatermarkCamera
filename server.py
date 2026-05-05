#!/usr/bin/env python3
"""
水印相机本地服务器 — 一键启动，手机扫码/输入地址即可使用。

首次运行会自动生成自签名证书（需要先安装 Python 的 cryptography 库）。
手机浏览器会提示证书不受信任，点击"继续访问"即可。
"""

import http.server
import socket
import sys
import os
import ssl
import ipaddress

PORT = 8888
CERT_FILE = 'cert.pem'
KEY_FILE = 'key.pem'

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    finally:
        s.close()

def generate_cert():
    """生成自签名证书"""
    print('  🔐 正在生成自签名证书...')
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, 'WatermarkCamera'),
    ])

    now = datetime.datetime.now(datetime.UTC)
    cert = x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(
        key.public_key()
    ).serial_number(x509.random_serial_number()).not_valid_before(
        now
    ).not_valid_after(
        now + datetime.timedelta(days=3650)
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName('localhost'),
            x509.IPAddress(ipaddress.IPv4Address(get_ip())),
        ]),
        critical=False,
    ).sign(key, hashes.SHA256())

    with open(CERT_FILE, 'wb') as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(KEY_FILE, 'wb') as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()
        ))
    print('  ✅ 证书生成完成\n')

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # 检查/生成证书
    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        generate_cert()

    ip = get_ip()
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), Handler)

    # 创建 SSL 上下文
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT_FILE, KEY_FILE)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print(f'\n  ✅ 水印相机已启动 (HTTPS)')
    print(f'  📱 手机浏览器访问: https://{ip}:{PORT}')
    print(f'  💻 电脑浏览器访问: https://localhost:{PORT}')
    print(f'\n  ⚠️  首次访问会提示"连接不是私密连接"，点击"高级 → 继续访问"即可')
    print(f'  按 Ctrl+C 停止服务\n')
    httpd.serve_forever()
