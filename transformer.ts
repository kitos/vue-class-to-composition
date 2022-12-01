import type { CallExpression, JSCodeshift } from 'jscodeshift'
import * as K from 'ast-types/gen/kinds'
import { methodDefinition } from 'jscodeshift'

let getDecorator = (n: any, name: string): K.DecoratorKind | undefined =>
  n.decorators && n.decorators.find((d) => d.expression.callee.name === name)

const isLifeCycleMethod = (name: string) =>
  [
    'beforeCreate',
    'created',
    'beforeMount',
    'mounted',
    'beforeUnmount',
    'unmounted',
  ].includes(name)

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

  let { statement, expression } = j.template

  let srcCollection = j(src)
  let toImportFromComposition = new Set()

  srcCollection.find(j.ClassDeclaration).forEach((classPath) => {
    let classMethods = classPath.node.body.body
    let exposeToTemplate: string[] = []
    let provides = []
    let injects = []
    let props: [string, K.ExpressionKind][] = []
    let hooks = []
    let computed: [string, K.StatementKind][] = []
    let watchers = []
    let functions = []
    let refs: [string, K.StatementKind][] = []
    let emittedEvents = []
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
          const typeAnnotation = classMethod.typeAnnotation?.typeAnnotation
          const name =
            typeAnnotation?.type === 'TSTypeReference'
              ? typeAnnotation.typeName.name
              : null
          let args = propDecorator.expression.arguments[0]
          if (name) {
            args.properties.forEach((arg) => {
              if (arg.key.name === 'type') {
                toImportFromComposition.add('PropType')
                arg.value = expression`${arg.value.name} as PropType<${name}>`
              }
            })
          }
          props.push([propName, args])
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

        let watchDecorator = getDecorator(classMethod, 'Watch')

        if (!isLifeCycleMethod(propName)) {
          exposeToTemplate.push(propName)
        }

        // getter
        if (classMethod.kind === 'get') {
          toImportFromComposition.add('computed')
          const body =
            classMethod.body.body[0].type === 'ReturnStatement'
              ? classMethod.body.body[0].argument
              : classMethod.body
          computed.push([
            propName,
            statement`const ${propName} = computed(() => ${body});`,
          ])
        } else if (
          watchDecorator &&
          j.CallExpression.check(watchDecorator.expression)
        ) {
          toImportFromComposition.add('watch')
          const watcherArgs = watchDecorator.expression.arguments
          const watchedExpression =
            watcherArgs?.[0].type === 'StringLiteral' && watcherArgs[0].value
          const watcherOptions =
            watcherArgs[1]?.type === 'ObjectExpression' && watcherArgs[1]
          // If watcher has options like `{ immediate: true }`
          if (watcherOptions) {
            watchers.push(
              statement`watch(() => ${watchedExpression} /* Check: is this argument reactive? */, () => ${classMethod.body}, ${watcherOptions});`
            )
          } else {
            watchers.push(
              statement`watch(() => ${watchedExpression} /* Check: is this argument reactive? */, () => ${classMethod.body});`
            )
          }
        } else {
          if (propName === 'mounted') {
            toImportFromComposition.add('onMounted')
            hooks.push(statement`onMounted(() => ${classMethod.body});`)
          } else if (propName === 'beforeDestroy') {
            toImportFromComposition.add('onBeforeUnmount')
            hooks.push(statement`onBeforeUnmount(() => ${classMethod.body});`)
          } else if (propName === 'created') {
            hooks.push(...classMethod.body.body.map((st) => statement`${st}`))
          } else {
            const fn = j.functionDeclaration(
              j.identifier(propName),
              classMethod.params,
              classMethod.body
            )
            fn.returnType = classMethod.returnType
            functions.push(fn)
          }
        }
      } else {
        unknown.push(classMethod)
      }
    }

    let setup = j.blockStatement([
      ...provides,
      ...injects,
      ...refs.map(([, st]) => st),
      ...hooks,
      ...computed.map(([, st]) => st),
      ...watchers,
      ...functions,
      ...unknown,
    ])

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

    let needProps = false
    let needEmit = false

    const declaration = srcCollection.find(j.ClassDeclaration)

    j(classPath)
      .find(j.MemberExpression)
      .forEach((path) => {
        let thisExp = path.node

        if (j.ThisExpression.check(thisExp.object)) {
          if (j.Identifier.check(thisExp.property)) {
            let { name } = thisExp.property

            if (name === '$nextTick') {
              toImportFromComposition.add('nextTick')
              path.replace(j.identifier('nextTick'))
              return
            } else if (name === '$emit') {
              needEmit = true
              // Add to a list for `defineEmits()`
              emittedEvents.push(path.parent.value.arguments[0].value)
              path.replace(j.identifier('emit'))
              return
            } else if (props.some(([n]) => n === name)) {
              needProps = true
              path.replace(
                j.memberExpression(j.identifier('props'), thisExp.property)
              )
              return
            } else if ([...refs, ...computed].some(([n]) => n === name)) {
              path.replace(
                j.memberExpression(j.identifier(name), j.identifier('value'))
              )
              return
            }
          }

          path.replace(thisExp.property)
        }
      })

    // Define props
    if (needProps) {
      srcCollection
        .find(j.ExportDefaultDeclaration)
        .insertBefore(
          statement`const props = defineProps(${j.objectExpression(
            props.map((p) => prop(...p))
          )});`
        )
    }

    // Define emits
    if (needEmit) {
      srcCollection
        .find(j.ExportDefaultDeclaration)
        .insertBefore(
          statement`const emit = defineEmits(${j.arrayExpression(
            emittedEvents.map((str) => j.stringLiteral(str))
          )});`
        )
    }

    srcCollection.find(j.ExportDefaultDeclaration).replaceWith(setup.body)
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
        str('vue')
      )
    )

  return srcCollection.toSource()
}

export default transformer
