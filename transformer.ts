import type { JSCodeshift } from 'jscodeshift'
import * as K from 'ast-types/gen/kinds'
import { methodDefinition } from 'jscodeshift'

let getDecorator = (n: any, name: string): K.DecoratorKind | undefined =>
  n.decorators && n.decorators.find((d) => d.expression.callee.name === name)

const transformer = (src: string, j: JSCodeshift) => {
  let str = (s = 'add something') => j.stringLiteral(s)

  let prop = (name: string, value: K.ExpressionKind | K.PatternKind = str()) =>
    j.property('init', j.identifier(name), value)

  let call = (
    n: string,
    args: (K.ExpressionKind | K.SpreadElementKind)[] = [],
    typeParameters: any = null
  ) =>
    j.callExpression.from({
      callee: j.identifier(n),
      arguments: args,
      // @ts-ignore
      typeParameters,
    })

  let { statement } = j.template

  let srcCollection = j(src)
  let toImportFromComposition = new Set()

  srcCollection.find(j.ClassDeclaration).forEach((classPath) => {
    let classMethods = classPath.node.body.body
    let exposeToTemplate = []
    let provides = []
    let injects = []
    let props: [string, K.ExpressionKind][] = []
    let hooks = []
    let computed = []
    let functions = []
    let refs: [string, K.StatementKind][] = []
    let unknown = []

    for (let classMethod of classMethods) {
      if (j.ClassProperty.check(classMethod)) {
        let propName = j.Identifier.check(classMethod.key)
          ? classMethod.key.name
          : 'unknown'
        let provideDecorator = getDecorator(classMethod, 'Provide')
        let injectDecorator = getDecorator(classMethod, 'Inject')
        let propDecorator = getDecorator(classMethod, 'Prop')

        if (
          provideDecorator &&
          j.CallExpression.check(provideDecorator.expression)
        ) {
          let arg = provideDecorator.expression.arguments[0]
          let injectName = j.StringLiteral.check(arg) ? arg : str('unknown-key')

          toImportFromComposition.add('provide')
          provides.push(
            statement`const ${propName} = provide(${injectName}, ${classMethod.value});`
          )
          // inject
        } else if (
          injectDecorator &&
          j.CallExpression.check(injectDecorator.expression)
        ) {
          let arg = injectDecorator.expression.arguments[0]
          let injectName = j.StringLiteral.check(arg) ? arg : str('unknown-key')
          let type = classMethod.typeAnnotation?.typeAnnotation

          toImportFromComposition.add('inject')
          exposeToTemplate.push(propName)
          injects.push(
            type
              ? statement`const ${propName} = inject<${type}>(${injectName});`
              : statement`const ${propName} = inject(${injectName});`
          )
          // prop
        } else if (
          propDecorator &&
          j.CallExpression.check(propDecorator.expression)
        ) {
          props.push([propName, propDecorator.expression.arguments[0]])
        } else {
          let type = classMethod.typeAnnotation?.typeAnnotation

          toImportFromComposition.add('ref')
          refs.push([
            propName,
            type
              ? statement`const ${propName} = ref<${type}>(${classMethod.value});`
              : statement`const ${propName} = ref(${classMethod.value});`,
          ])
        }
      } else if (j.ClassMethod.check(classMethod)) {
        let propName = j.Identifier.check(classMethod.key)
          ? classMethod.key.name
          : 'unknown'

        exposeToTemplate.push(propName)

        // getter
        if (classMethod.kind === 'get') {
          toImportFromComposition.add('computed')
          computed.push(
            statement`const ${propName} = computed(() => ${classMethod.body});`
          )
        } else {
          if (propName === 'mounted') {
            toImportFromComposition.add('onMounted')
            hooks.push(statement`onMounted(() => ${classMethod.body});`)
          } else if (propName === 'beforeDestroy') {
            toImportFromComposition.add('onBeforeUnmount')
            hooks.push(statement`onBeforeUnmount(() => ${classMethod.body});`)
          } else {
            functions.push(
              j.functionDeclaration(
                j.identifier(propName),
                classMethod.params,
                classMethod.body
              )
            )
          }
        }
      } else {
        unknown.push(classMethod)
      }
    }

    let propsProp = prop(
      'props',
      j.objectExpression(props.map((p) => prop(...p)))
    )

    let returnStatement = statement`return ${j.objectExpression(
      exposeToTemplate.map((v) =>
        j.property.from({
          kind: 'init',
          key: j.identifier(v),
          shorthand: true,
          value: j.identifier(v),
        })
      )
    )}`

    let setup = j.objectMethod(
      'method',
      j.identifier('setup'),
      [j.identifier('props')],
      j.blockStatement([
        ...provides,
        ...injects,
        ...refs.map(([, st]) => st),
        ...hooks,
        ...computed,
        ...functions,
        ...unknown,
        returnStatement,
      ])
    )

    let componentsProp
    let compDecorator = getDecorator(classPath.node, 'Component')?.expression
    if (j.CallExpression.check(compDecorator)) {
      let arg = compDecorator.arguments[0]
      if (j.ObjectExpression.check(arg)) {
        componentsProp = arg.properties.filter(
          (p) =>
            j.ObjectProperty.check(p) &&
            j.Identifier.check(p.key) &&
            p.key.name === 'components'
        )[0]
      }
    }

    toImportFromComposition.add('defineComponent')

    let needProps = false

    j(classPath)
      .replaceWith(
        call('defineComponent', [
          j.objectExpression(
            [componentsProp, propsProp, setup].filter(Boolean)
          ),
        ])
      )
      .find(j.MemberExpression)
      .forEach((path) => {
        let thisExp = path.node

        if (j.ThisExpression.check(thisExp.object)) {
          if (j.Identifier.check(thisExp.property)) {
            let { name } = thisExp.property

            if (props.some(([n]) => n === name)) {
              needProps = true
              path.replace(
                j.memberExpression(j.identifier('props'), thisExp.property)
              )
            } else if (refs.some(([n]) => n === name)) {
              path.replace(
                j.memberExpression(j.identifier(name), j.identifier('value'))
              )
            }
          } else {
            // TODO: refs? inject?
            path.replace(thisExp.property)
          }
        }
      })

    if (!needProps) {
      setup.params = []
    }
  })

  srcCollection
    .find(
      j.ImportDeclaration,
      (i) => i.source.value === 'vue-property-decorator'
    )
    .replaceWith(
      j.importDeclaration(
        [...toImportFromComposition]
          .sort()
          .map((n) => j.importSpecifier(j.identifier(n))),
        str('@vue/composition-api')
      )
    )

  return srcCollection.toSource()
}

export default transformer
