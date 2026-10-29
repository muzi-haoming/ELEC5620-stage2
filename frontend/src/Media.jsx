import { useLanguage, translate as _tr } from "./Language";
import React, { useState, useEffect } from 'react';
import { readPhoto, savePhoto } from './photos.mjs';
export function Photo({
  src,
  alt,
  ...props
}) {
  const _tr = useLanguage();
  const [resolved, setResolved] = useState(src?.startsWith('idb:') ? '' : src);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      url;
    setError(false);
    if (!src?.startsWith('idb:')) {
      setResolved(src);
      return;
    }
    setResolved('');
    readPhoto(src).then(record => {
      if (!active) return;
      if (!record) {
        setError(true);
        return;
      }
      url = URL.createObjectURL(record.preview);
      setResolved(url);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);
  return resolved ? <img src={resolved} alt={_tr(alt)} {...props} /> : <div className="photo-placeholder" role="img" aria-label={_tr(alt)}>{_tr(error ? '照片无法加载' : '照片加载中')}</div>;
}
export function PhotoUpload({
  photos,
  onChange,
  errors,
  onBusy
}) {
  const _tr = useLanguage();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function upload(key, files) {
    if (!files.length) return;
    setBusy(key);
    onBusy?.(true);
    setError('');
    try {
      if (key === 'details' && photos.details.length + files.length > 2) throw Error('其他细节最多 2 张');
      const stored = [];
      for (const file of files) stored.push(await savePhoto(file));
      onChange({
        ...photos,
        [key]: key === 'details' ? [...photos.details, ...stored] : stored[0]
      });
    } catch (e) {
      setError(e.message || '图片上传失败，请稍后重试。');
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  return <div><div className="photo-slots">{_tr([['front', '正面'], ['top', '俯视'], ['side', '侧面']].map(([key, label]) => <div className={'photo-slot ' + (errors[key] ? 'invalid' : '')} key={key}><label><b>{_tr(label)} *</b>{_tr(photos[key] ? <Photo src={photos[key].ref} alt={_tr(label)} /> : <div className="photo-placeholder">{_tr("\uFF0B \u6DFB\u52A0\u7167\u7247")}</div>)}<input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif" disabled={!!busy} aria-label={_tr(label + '照片')} onChange={e => {
            upload(key, [...e.target.files]);
            e.target.value = '';
          }} /><small>{_tr(busy === key ? '正在处理…' : photos[key]?.name || '选择照片')}</small></label>{_tr(errors[key] && <p className="field-error">{_tr(errors[key])}</p>)}</div>))}</div><div className="detail-upload"><b>{_tr("\u5176\u4ED6\u7EC6\u8282 / \u65B9\u5411\uFF08\u9009\u586B\uFF0C\u6700\u591A 2 \u5F20\uFF09")}</b><div className="detail-thumbs">{_tr(photos.details.map((p, i) => <div key={p.ref}><Photo src={p.ref} alt={_tr('其他细节 ' + (i + 1))} /><button type="button" onClick={() => onChange({
            ...photos,
            details: photos.details.filter((_, n) => n !== i)
          })} disabled={!!busy}>{_tr("\u79FB\u9664")}</button></div>))}</div><label className="detail-file-label"><span>{_tr("选择照片")}</span><input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.heif" aria-label={_tr("其他细节照片")} disabled={!!busy || photos.details.length >= 2} onChange={e => {
        upload('details', [...e.target.files]);
        e.target.value = '';
      }} /></label></div><p className="muted">{_tr("\u652F\u6301 JPEG\u3001PNG\u3001WebP\u3001HEIC \xB7 \u5355\u5F20\u4E0D\u8D85\u8FC7 15 MB")}</p>{_tr(error && <p className="field-error" role="alert">{_tr(error)}</p>)}</div>;
}
