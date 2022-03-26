import * as jscodeshift from 'jscodeshift'
import transformer from './transformer'
import pkg from './package.json'

addEventListener('message', ({ data: source }) => postMessage(transformer(source, jscodeshift.withParser('ts'))))
