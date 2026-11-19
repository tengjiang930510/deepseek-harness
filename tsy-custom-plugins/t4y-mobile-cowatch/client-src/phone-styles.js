    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      // Phone-only light cosmetics. No AppFrame grid rewrite, no chat width
      // overrides, no shortcut dock — those broke desktop / failed to ship.
      style.textContent = `
        /* Do NOT display:none identity restoring/login here.
           WaitGate mounts via slots and can lag behind identity boot; hiding those
           gates left a blank white/black shell on phone browsers. WaitGate already
           covers the viewport (z-index 10050) when it needs to. */
        .t4y-mobile-cowatch-root {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          /* Prefer explicit light fallback — phone theme tokens may resolve dark/empty. */
          background: #f8fafc;
          color: #0f172a;
          font-family: var(--dsw-font-sans, system-ui, sans-serif);
        }
        .t4y-mobile-cowatch-card {
          width: min(420px, 100%);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .t4y-mobile-cowatch-title {
          margin: 0;
          font-size: 20px;
          line-height: 28px;
          font-weight: 600;
          color: #0f172a !important;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-cowatch-body {
          margin: 0;
          font-size: 14px;
          line-height: 22px;
          color: #475569 !important;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-cowatch-status {
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          color: #64748b !important;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-cowatch-idle-root {
          position: fixed;
          inset: 0;
          z-index: 10060;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(15, 23, 42, 0.55);
          color: #0f172a;
          font-family: var(--dsw-font-sans, system-ui, sans-serif);
        }
        .t4y-mobile-cowatch-idle-card {
          width: min(420px, 100%);
          padding: 24px;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 8px 30px rgba(15, 23, 42, 0.18);
        }
        .t4y-mobile-cowatch-idle-card h2 {
          margin: 0 0 8px;
          font-size: 18px;
          line-height: 26px;
          color: #0f172a !important;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-cowatch-idle-card p {
          margin: 0 0 16px;
          font-size: 14px;
          line-height: 22px;
          color: #475569 !important;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-cowatch-idle-card button {
          width: 100%;
          padding: 12px 16px;
          border: 0;
          border-radius: 8px;
          background: #0f1115;
          color: #fff !important;
          font-size: 16px;
          font-weight: 600;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-switch-root {
          position: fixed;
          inset: 0;
          z-index: 10060;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          background: rgba(15, 17, 21, 0.45);
          padding: 1rem;
        }
        .t4y-mobile-switch-card {
          width: min(22rem, 100%);
          max-height: min(70vh, 32rem);
          overflow: auto;
          background: #fff;
          color: #111827;
          border-radius: 14px;
          padding: 1.1rem 1.1rem 1rem;
          box-shadow: 0 10px 30px rgba(0,0,0,.18);
        }
        .t4y-mobile-switch-card h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
        .t4y-mobile-switch-card .t4y-mobile-switch-body {
          margin: 0 0 0.85rem;
          color: #6b7280;
          font-size: 0.88rem;
          line-height: 1.45;
        }
        .t4y-mobile-switch-list { list-style: none; margin: 0; padding: 0; }
        .t4y-mobile-switch-list button {
          width: 100%;
          text-align: left;
          margin: 0 0 0.5rem;
          padding: 0.75rem 0.85rem;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #111827 !important;
          font-size: 0.95rem;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-switch-list button.is-ready {
          border-color: #86efac;
          background: #f0fdf4;
        }
        .t4y-mobile-switch-list button.is-current {
          border-color: #93c5fd;
          background: #eff6ff;
          box-shadow: inset 0 0 0 1px #93c5fd;
        }
        .t4y-mobile-switch-list button.is-off {
          border-color: #fcd34d;
          background: #fffbeb;
        }
        .t4y-mobile-switch-list button.is-offline {
          border-color: #e5e7eb;
          background: #f9fafb;
          opacity: 0.88;
        }
        .t4y-mobile-switch-list button[disabled] { cursor: not-allowed; }
        .t4y-mobile-switch-list .meta {
          display: block;
          margin-top: 0.25rem;
          color: #6b7280;
          font-size: 0.78rem;
        }
        .t4y-mobile-switch-list .badge {
          display: inline-block;
          margin-left: 0.35rem;
          padding: 0.1rem 0.4rem;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 600;
          vertical-align: middle;
        }
        .t4y-mobile-switch-list .badge.ready { background: #dcfce7; color: #166534; }
        .t4y-mobile-switch-list .badge.current { background: #dbeafe; color: #1d4ed8; }
        .t4y-mobile-switch-list .badge.off { background: #fef3c7; color: #b45309; }
        .t4y-mobile-switch-list .badge.offline { background: #f3f4f6; color: #6b7280; }
        .t4y-mobile-switch-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          margin-top: 0.35rem;
        }
        .t4y-mobile-switch-actions button {
          padding: 0.65rem 0.75rem;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: #fff;
          /* 覆盖产品暗色主题的全局 button 字色，避免白底看不见字 */
          color: #111827 !important;
          font-size: 0.9rem;
          font-weight: 600;
          line-height: 1.25;
          -webkit-text-fill-color: currentColor;
        }
        .t4y-mobile-switch-actions button.primary {
          background: #0f1115;
          color: #fff !important;
          border-color: #0f1115;
        }
        .t4y-mobile-switch-select-link {
          display: block;
          width: 100%;
          margin-top: 0.55rem;
          padding: 0.45rem 0.5rem;
          border: 0;
          background: transparent;
          color: #2563eb !important;
          font-size: 0.88rem;
          font-weight: 500;
          text-align: center;
          -webkit-text-fill-color: currentColor;
          cursor: pointer;
        }
        html[data-t4y-mobile-cowatch="1"] [role="menu"] {
          z-index: 4000 !important;
        }
        /* 手机进入会话：隐藏电脑端「移动访问」开关，避免误操作本机 FRP */
        html[data-t4y-mobile-cowatch="1"] [data-t4y-mobile-access-item="1"],
        html[data-t4y-mobile-cowatch="1"] .dsh-mobile-control__trigger {
          display: none !important;
        }
        html[data-t4y-mobile-cowatch="1"] [aria-label="账号菜单"] span[class*="label"],
        html[data-t4y-mobile-cowatch="1"] [aria-label="Account menu"] span[class*="label"] {
          max-width: 9em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] {
          flex-direction: column !important;
          width: min(100vw - 24px, 800px) !important;
          max-width: calc(100vw - 24px) !important;
          height: min(100dvh - 24px, 800px) !important;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav {
          width: 100% !important;
          gap: 10px !important;
          padding: 14px 12px 0 !important;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav > div:last-child {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          overflow-x: auto !important;
          overflow-y: hidden !important;
          gap: 4px !important;
          scroll-padding-inline: 8px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav > div:last-child::-webkit-scrollbar {
          display: none;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav button {
          flex: none !important;
          height: 36px !important;
        }
        html[data-t4y-mobile-cowatch="1"] [role="menu"] kbd,
        html[data-t4y-mobile-cowatch="1"] [role="menuitem"] [class*="Shortcut"],
        html[data-t4y-mobile-cowatch="1"] [role="menuitem"] [class*="shortcut"] {
          display: none !important;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shell-bottom] {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shell-bottom] button span {
          max-width: 28vw;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `
      document.head.appendChild(style)
    }
