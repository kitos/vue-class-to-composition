import './editor'
import { editor } from 'monaco-editor/esm/vs/editor/editor.api'
import TramsformWorker from './worker.ts?worker'

const mountEditor = (root: string, readOnly = false) =>
  editor.create(document.querySelector(root), {
    language: 'typescript',
    readOnly,
    minimap: { enabled: false },
  })

let transformWorker = new TramsformWorker()

let srcEditor = mountEditor('#src')
let resultEditor = mountEditor('#result', true)

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

@Component<ProgressBar>({})
export default class ProgressBar extends Vue {
@Inject('someStore') readonly someStore!: SomeStore
@Prop({ type: Number, required: true }) readonly max!: number
@Prop({ type: Number, default: 0 }) readonly value!: number
}`)
