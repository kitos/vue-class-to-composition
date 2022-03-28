import { mountEditor } from './monaco'

let srcEditor = mountEditor('#src')
let resultEditor = mountEditor('#result', true)

let transformWorker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
})

srcEditor
  .getModel()
  .onDidChangeContent((e) =>
    transformWorker.postMessage(srcEditor.getModel().getValue())
  )

transformWorker.addEventListener('message', (e) => resultEditor.setValue(e.data))

transformWorker.addEventListener('error', console.error)

srcEditor.setValue(`import { Component, Prop, Vue } from 'vue-property-decorator'

@Component<ProgressBar>({})
export default class ProgressBar extends Vue {
@Inject('someStore') readonly someStore!: SomeStore
@Prop({ type: Number, required: true }) readonly max!: number
@Prop({ type: Number, default: 0 }) readonly value!: number
}`)
