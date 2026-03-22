import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        expand: () => void;
        close: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        HapticFeedback: {
          impactOccurred: (style: "light" | "medium" | "heavy") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          setText: (text: string) => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          show: () => void;
          hide: () => void;
          setParams: (params: { color?: string; text_color?: string; is_active?: boolean }) => void;
        };
        ready: () => void;
        platform: string;
        colorScheme: string;
        themeParams: Record<string, string>;
      };
    };
  }
}

interface TelegramContextValue {
  isTelegram: boolean;
  telegramUser: { id: number; firstName: string; lastName?: string; username?: string } | null;
  hapticLight: () => void;
  hapticMedium: () => void;
  hapticSuccess: () => void;
  hapticError: () => void;
  showMainButton: (text: string, onClick: () => void) => void;
  hideMainButton: () => void;
}

const TelegramContext = createContext<TelegramContextValue>({
  isTelegram: false,
  telegramUser: null,
  hapticLight: () => {},
  hapticMedium: () => {},
  hapticSuccess: () => {},
  hapticError: () => {},
  showMainButton: () => {},
  hideMainButton: () => {},
});

export function useTelegram() {
  return useContext(TelegramContext);
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [isTelegram, setIsTelegram] = useState(false);
  const [telegramUser, setTelegramUser] = useState<TelegramContextValue["telegramUser"]>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) {
      setIsTelegram(true);

      tg.expand();
      tg.setHeaderColor("#080E1A");
      tg.setBackgroundColor("#080E1A");
      tg.ready();

      document.body.classList.add("telegram-mode");

      const user = tg.initDataUnsafe?.user;
      if (user) {
        setTelegramUser({
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
        });
      }
    }

    return () => {
      document.body.classList.remove("telegram-mode");
    };
  }, []);

  const hapticLight = () => {
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  const hapticMedium = () => {
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium"); } catch {}
  };

  const hapticSuccess = () => {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
  };

  const hapticError = () => {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
  };

  const mainButtonCallbackRef = { current: () => {} };

  const showMainButton = (text: string, onClick: () => void) => {
    try {
      const mb = window.Telegram?.WebApp?.MainButton;
      if (!mb) return;
      mb.offClick(mainButtonCallbackRef.current);
      mainButtonCallbackRef.current = onClick;
      mb.setText(text);
      mb.setParams({ color: "#C8391A", text_color: "#EEE8DC" });
      mb.onClick(onClick);
      mb.show();
    } catch {}
  };

  const hideMainButton = () => {
    try {
      const mb = window.Telegram?.WebApp?.MainButton;
      if (!mb) return;
      mb.offClick(mainButtonCallbackRef.current);
      mb.hide();
    } catch {}
  };

  return (
    <TelegramContext.Provider
      value={{
        isTelegram,
        telegramUser,
        hapticLight,
        hapticMedium,
        hapticSuccess,
        hapticError,
        showMainButton,
        hideMainButton,
      }}
    >
      {children}
    </TelegramContext.Provider>
  );
}
