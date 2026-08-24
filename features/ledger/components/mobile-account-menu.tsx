"use client";

import { useEffect, useRef, useState } from "react";

type MobileAccountMenuProps = {
  avatarUrl: string;
  authenticated: boolean;
  registrationOpen: boolean;
  username: string;
  onLogin: () => void;
  onLogout: () => void | Promise<void>;
  onSettings: () => void;
};

export function MobileAccountMenu({
  avatarUrl,
  authenticated,
  registrationOpen,
  username,
  onLogin,
  onLogout,
  onSettings,
}: MobileAccountMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function closeAndRun(action: () => void | Promise<void>) {
    setOpen(false);
    void action();
  }

  return (
    <div className={`mobile-account-menu${open ? " is-open" : ""}`} ref={containerRef}>
      <button
        className="mobile-account-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? "关闭账户菜单" : "打开账户菜单"}
        onClick={() => setOpen((current) => !current)}
      >
        {avatarUrl ? (
          <img className="header-avatar" src={avatarUrl} alt="用户头像" />
        ) : (
          <span className="header-avatar-fallback">{username?.[0]?.toUpperCase() || "G"}</span>
        )}
      </button>
      {open ? (
        <div className="mobile-account-popover" role="menu">
          <div>
            <strong>{authenticated ? username : "访客"}</strong>
            <span>{authenticated ? "管理员账户" : "只读浏览"}</span>
          </div>
          {authenticated ? (
            <>
              <button type="button" role="menuitem" onClick={() => closeAndRun(onSettings)}>
                设置
              </button>
              <button
                className="mobile-account-logout"
                type="button"
                role="menuitem"
                onClick={() => closeAndRun(onLogout)}
              >
                退出登录
              </button>
            </>
          ) : (
            <button type="button" role="menuitem" onClick={() => closeAndRun(onLogin)}>
              {registrationOpen ? "注册管理员" : "管理员登录"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
