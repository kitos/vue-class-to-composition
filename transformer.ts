import type { JSCodeshift } from 'jscodeshift'
import * as K from 'ast-types/gen/kinds'

let getDecorator = (n: any, name: string): K.DecoratorKind =>
  n.decorators && n.decorators.find((d) => d.expression.callee.name === name)

const transformer = (src: string, j: JSCodeshift) => {
  let str = (s = 'add something') => j.stringLiteral(s)

  let prop = (name: string, value: K.ExpressionKind | K.PatternKind = str()) =>
    j.property('init', j.identifier(name), value)

  let cnst = (n: string, v: K.ExpressionKind | null = str()) =>
    j.variableDeclaration('const', [j.variableDeclarator(j.identifier(n), v)])

  let call = (
    n: string,
    args: (K.ExpressionKind | K.SpreadElementKind)[] = []
  ) => j.callExpression(j.identifier(n), args)

  return j(src)
    .find(j.ClassDeclaration)
    .forEach((path) => {
      let classMethods = path.node.body.body

      const propSrc = classMethods.filter((m) => getDecorator(m, 'Prop'))
      const injectSrc = classMethods.filter((m) => getDecorator(m, 'Inject'))
      const gettersSrc = classMethods.filter((m) => m.kind === 'get')
      const otherItems = classMethods.filter(
        (m) =>
          !propSrc.includes(m) &&
          !injectSrc.includes(m) &&
          !gettersSrc.includes(m)
      )

      let props = propSrc.map((p) => {
        let d = getDecorator(p, 'Prop')
        return prop(p.key.name, d.expression.arguments[0])
      })
      let propsProp = prop('props', j.objectExpression(props))

      let injects = injectSrc.map((i) => {
        let d = getDecorator(i, 'Inject')
        let name = d.expression.arguments[0].value
        return cnst(name, call('inject', [j.stringLiteral(name)]))
      })

      let computed = gettersSrc.map((g) => {
        return cnst(
          g.key.name,
          call('computed', [j.arrowFunctionExpression([], g.body)])
        )
      })

      let unknown = []
      let functions = []

      for (let o of otherItems) {
        if (j.ClassMethod.check(o)) {
          const name = j.Identifier.check(o.key) ? o.key.name : 'someName'
          functions.push(
            j.functionDeclaration(j.identifier(name), o.params, o.body)
          )
        } else {
          unknown.push(o)
        }
      }

      let setup = j.objectMethod(
        'method',
        j.identifier('setup'),
        [],
        j.blockStatement([...injects, ...computed, ...functions, ...unknown])
      )

      j(path)
        .replaceWith(
          call('defineComponent', [j.objectExpression([propsProp, setup])])
        )
        .find(j.MemberExpression)
        .forEach((path) => {
          if (j.ThisExpression.check(path.node.object)) {
            // TODO: check props and root
            path.replace(path.node.property)
          }
        })
    })
    .toSource()
}

export default transformer
