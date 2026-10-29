/**
 * 「关于」卡片：软件端菜单和导出页水印点开的，是同一份内容。
 *
 * 只负责内容与样式；遮罩容器、开关逻辑由各自的宿主（app 的 showAbout / 导出页的 player.js）负责。
 * 版本号与 package.json 对齐（build-app 构建时会校验）。
 */
export const ABOUT_VERSION = '2.6.2';

const REPO = 'https://github.com/liuluming0916-lgtm/xiaofeiyu-physics-animation';

export const ABOUT_HTML =
  `<h3>小肥鱼物理动画<span>v${ABOUT_VERSION}</span></h3>` +
  `<ul class="xfy-about-list">` +
  `<li><b>邮箱</b><a href="mailto:1241640869@qq.com">1241640869@qq.com</a></li>` +
  `<li><b>QQ</b>1241640869</li>` +
  `<li><b>微信</b>AluneOfficial</li>` +
  `<li><b>仓库</b><a href="${REPO}" target="_blank" rel="noopener"><span>github.com/liuluming0916-lgtm/</span><wbr><span>xiaofeiyu-physics-animation</span></a></li>` +
  `<li><b>协议</b>AGPL-3.0：教学免费，商用需授权</li>` +
  `</ul>` +
  `<div class="xfy-about-foot"><button type="button" data-xfy-close>关闭</button></div>`;

export const ABOUT_CSS = `
.xfy-about-mask{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;
     background:rgba(20,30,45,.42);font-family:"Microsoft YaHei","PingFang SC",sans-serif;}
.xfy-about-mask.on{display:flex;}
.xfy-about-card{box-sizing:border-box;width:100%;max-width:520px;max-height:calc(100vh - 48px);overflow:auto;background:#fff;
     border-radius:14px;padding:22px 24px 20px;text-align:left;box-shadow:0 24px 60px rgba(20,30,45,.28);}
.xfy-about-card h3{margin:0 0 8px;font-size:17px;color:#1f2a3a;font-weight:600;}
.xfy-about-card h3 span{font-size:11.5px;color:#8b98a8;font-weight:400;margin-left:6px;}
.xfy-about-list{margin:0;padding:0;list-style:none;font-size:12.5px;line-height:2.1;color:#3b4a5e;}
.xfy-about-list li{display:grid;grid-template-columns:54px 1fr;align-items:baseline;}
.xfy-about-list b{color:#1f2a3a;font-weight:600;}
.xfy-about-card a{color:#2f6feb;text-decoration:none;}
.xfy-about-card a:hover{text-decoration:underline;}
.xfy-about-card a span{white-space:nowrap;}
.xfy-about-foot{display:flex;justify-content:flex-end;margin-top:16px;}
.xfy-about-foot button{border:1px solid #cdd8e8;background:#f7f9fd;border-radius:8px;padding:7px 16px;
     font-family:inherit;font-size:13px;color:#1f2a3a;cursor:pointer;transition:.15s;}
.xfy-about-foot button:hover{background:#eaf1fd;border-color:#9fbcf0;}
`;
