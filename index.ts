import { mountEditor, setTheme } from './editor'

let srcEditor = mountEditor('#src')
let resultEditor = mountEditor('#result', true)

let transformWorker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
})

const darkToggle = document.querySelector('#darkToggle') as HTMLInputElement
const savedPreference = localStorage.getItem('dark')
const browserPreference = window.matchMedia(
  '(prefers-color-scheme: dark)'
).matches
function updateTheme(dark: boolean) {
  localStorage.setItem('dark', dark ? '1' : '0')
  setTheme(dark ? 'vs-dark' : 'vs')
  darkToggle.checked = dark
  document.documentElement.classList[dark ? 'add' : 'remove']('dark')
}
updateTheme(savedPreference ? savedPreference === '1' : browserPreference)
darkToggle?.addEventListener('change', (event) =>
  updateTheme((event.target as HTMLInputElement).checked)
)

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
import { Button } from '@/components'

@Component<ProgressBar>({
  components: { Button }
})
export default class ProgressBar extends Vue {
  @Provide('provideKey') private readonly sharedState = new SharedState(42)
  @Inject('injectKey') readonly someStore!: SomeStore
  @Prop({ type: String, required: true }) readonly id!: number
  @Prop({ type: Number, default: 0 }) readonly value!: number
  @Prop({ type: Number, default: 0 }) readonly customProperty!: CustomClass
  
  data1: IData | null = null
  data2 = 123

  @Watch('customProperty')
  runEffect() {
    window.alert('changed')
  }

  @Watch('otherWatchedProperty', { immediate: true })
  runAnotherEffect() {
    window.alert('other thing changed')
  }
  
  get compute(): string {
    const thing = window.getThing()
    return thing + this.id.toString()
  }
  
  get oneLinerComputed(): string {
    return this.id.toString()
  }
  
  mounted() {
    fetch(this.id).then(d => this.data1 = d)
    
    this.$nextTick(() => {
      this.$emit('event', someStore.price)
    })
  }

  classMethod(input: number): number {
    return this.compute * input * 4
  }
}`)
