// Lets TypeScript import single-file components; their own types are checked by the Vue compiler at build.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
