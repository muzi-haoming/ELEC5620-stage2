import React, { createContext, useContext, useState } from 'react';
import { translations } from './translations.mjs';
const LanguageContext = createContext(null);
let active = localStorage.getItem('second-space-language') === 'en' ? 'en' : 'zh';
const pairs = Object.entries(translations).sort((a, b) => b[0].length - a[0].length);
export function translate(value) {
  if (active !== 'en' || typeof value !== 'string') return value;
  if (translations[value]) return translations[value];
  if (!/[\u3400-\u9fff]/.test(value)) return value;
  let text = value;
  for (const [zh, en] of pairs) text = text.split(zh).join(en);
  return text;
}
export function LanguageProvider({
  children
}) {
  const [language, setLanguage] = useState(active);
  active = language;
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  const change = v => {
    localStorage.setItem('second-space-language', v);
    setLanguage(v);
  };
  return <LanguageContext.Provider value={{
    language,
    change
  }}>{children}</LanguageContext.Provider>;
}
export function useLanguage() {
  useContext(LanguageContext);
  return translate;
}
export function LanguageSwitch() {
  const {
    language,
    change
  } = useContext(LanguageContext);
  return <div className="language-switch" aria-label="Language / 语言"><button aria-pressed={language === 'zh'} onClick={() => change('zh')}>中文</button><span>/</span><button aria-pressed={language === 'en'} onClick={() => change('en')}>EN</button></div>;
}
