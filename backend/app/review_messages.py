CATEGORY_MESSAGE = '照片中的家具与所选类别不一致，请检查家具类别；椅子、桌子、柜子请选择“其他”。'

MESSAGES = {
    'review_input_limit': '图片审核请求超过服务输入限制，尚未完成审核；请联系平台处理。',
    'photo_rejected': '上传图片不符合平台政策',
    'review_busy': '图片审核服务繁忙，请稍后重试；尚未判定图片是否合格。',
    'review_timeout': '图片审核超时，请稍后重试；尚未判定图片是否合格。',
    'review_unavailable': '图片审核服务暂不可用，请稍后重试；尚未判定图片是否合格。',
}

def review_status(assessment):
    mode=assessment.get('mode','')
    if mode.startswith('model_unavailable:'):
        if 'input_tokens_too_large' in mode:return 'review_input_limit'
        if 'HTTP429' in mode:return 'review_busy'
        if 'timeout' in mode.lower():return 'review_timeout'
        return 'review_unavailable'
    if not assessment.get('errors'):return 'ready'
    if mode=='input_validation':return 'input_invalid'
    if str(assessment.get('errors',{}).get('category','')).startswith('照片'):return 'category_mismatch'
    return 'photo_rejected'
