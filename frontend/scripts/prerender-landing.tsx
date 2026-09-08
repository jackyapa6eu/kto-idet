// Запускается после `vite build` (см. package.json). Лендинг («холодный» экран без
// организации/события — см. src/components/Landing.tsx) статичен и не зависит ни от
// пользователя, ни от Telegram-контекста, поэтому его можно один раз отрендерить в HTML прямо
// на этапе сборки — краулеры (особенно Яндекс, который слабо выполняет JS) увидят полный
// текст сразу, без выполнения бандла. React на клиенте всё равно полностью перерисует
// #root через createRoot().render() при загрузке — это не hydrate, поэтому расхождения в
// разметке между этим рендером и клиентским не страшны.
//
// createElement вместо JSX специально: у esbuild/tsx нет единого способа подхватить настройку
// "jsx": "react-jsx" из tsconfig.app.json для файла вне src/, а тратить время на настройку
// ради одного вызова не стоило.
import { readFileSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Landing } from '../src/components/Landing'

const DIST_INDEX_HTML = new URL('../dist/index.html', import.meta.url)

function main() {
  const html = readFileSync(DIST_INDEX_HTML, 'utf-8')
  const rendered = renderToStaticMarkup(createElement(Landing))

  if (!html.includes('<div id="root"></div>')) {
    throw new Error('prerender-landing: не нашёл пустой <div id="root"></div> в dist/index.html')
  }

  const withLanding = html.replace('<div id="root"></div>', `<div id="root">${rendered}</div>`)
  writeFileSync(DIST_INDEX_HTML, withLanding)
  console.log('prerender-landing: содержимое Landing вшито в dist/index.html')
}

main()
