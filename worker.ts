import * as jscodeshift from 'jscodeshift'
import prettier from 'prettier/standalone'
import parserTypeScript from 'prettier/parser-typescript'
import pkg from './package.json'
import transformer from './transformer'

addEventListener('message', ({ data: source }) =>
  postMessage(
    prettier.format(transformer(source, jscodeshift.withParser('ts')), {
      ...pkg.prettier,
      parser: 'typescript',
      plugins: [parserTypeScript],
    })
  )
)
