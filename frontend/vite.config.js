import {defineConfig} from 'vite';
export default defineConfig({server:{host:'127.0.0.1',port:5622,strictPort:true,proxy:{'/api':'http://127.0.0.1:8001'}}});
