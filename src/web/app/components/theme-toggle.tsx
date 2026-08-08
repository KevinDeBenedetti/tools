import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";

import { Button } from "#components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/ui/tooltip";
import { type Theme, applyTheme, readTheme, watchSystemTheme } from "#lib/theme";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICONS: Record<Theme, typeof SunIcon> = {
  dark: MoonIcon,
  light: SunIcon,
  system: MonitorIcon,
};

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const current = useRef(theme);
  current.current = theme;

  useEffect(() => watchSystemTheme(() => current.current), []);

  const cycle = (): void => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] as Theme;
    setTheme(next);
    applyTheme(next);
  };

  const Icon = ICONS[theme];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={cycle} aria-label={`Theme: ${theme}`}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Theme: {theme}</TooltipContent>
    </Tooltip>
  );
}
