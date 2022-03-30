import { mountEditor } from './editor'

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

transformWorker.addEventListener('message', (e) =>
  resultEditor.setValue(e.data)
)

transformWorker.addEventListener('error', console.error)

srcEditor.setValue(`import { Component, Prop, Vue } from 'vue-property-decorator'

@Component<ProgressBar>({
  components: { Button }
})
export default class ProgressBar extends Vue {
  @Inject('injectKey') readonly someStore!: SomeStore
  @Prop({ type: String, required: true }) readonly id!: number
  @Prop({ type: Number, default: 0 }) readonly value!: number
  
  data: IData = null
  
  get compute() {
    return this.id.toString()
  }
  
  async onMounted() {
    this.data = await fetch(this.id)
  }
}`)
