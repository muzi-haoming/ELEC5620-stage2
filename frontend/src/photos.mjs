export const MAX_PHOTO_BYTES=15*1024*1024;
export function validatePhoto(file){if(file.size>MAX_PHOTO_BYTES)throw Error('单张照片不能超过 15 MB');if(!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))throw Error('支持 JPEG、PNG、WebP、HEIC 格式');if(!file.size)throw Error('照片文件为空');}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('second-space-photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function readPhoto(ref){if(!ref?.startsWith('idb:'))return null;const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('photos','readonly');const r=tx.objectStore('photos').get(ref.slice(4));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
export async function savePhoto(file){
 validatePhoto(file);const body=new FormData();body.append('file',file);
 let response;try{response=await fetch('/api/media',{method:'POST',headers:{'X-Demo-Role':'seller'},body});}catch{throw Error('网络连接失败，图片尚未上传，请检查连接后重试。');}
 if(response.status===413)throw Error('单张照片不能超过 15 MB');
 if(response.status===429)throw Error('上传请求过于频繁，请稍后重试。');
 if(response.status>=500)throw Error('图片上传服务暂不可用，请稍后重试。');
 let data;try{data=await response.json();}catch{throw Error('图片上传服务返回异常，请稍后重试。');}
 if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'图片上传失败，请稍后重试。');return data;
}
