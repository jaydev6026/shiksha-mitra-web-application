(() => {
  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
  const toast = $('#toast')
  const stopButton = $('#stopVoice')
  const keyboard = $('#touchKeyboard')
  const keyboardBackdrop = $('#keyboardBackdrop')
  const audioContext = window.AudioContext || window.webkitAudioContext
  let context = null
  let recognition = null
  let recognitionTarget = null
  let activeInput = null
  let isShifted = false
  let currentAnswer = ''
  let toastTimer

  function resumeAudio() {
    if (!audioContext) return
    try {
      context ||= new audioContext()
      if (context.state === 'suspended') context.resume()
    } catch {}
  }

  document.addEventListener('touchstart', resumeAudio, { passive: true })
  document.addEventListener('pointerdown', resumeAudio, { passive: true })

  function showToast(message) {
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2900)
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    stopButton.hidden = true
  }

  function speak(text, language) {
    if (!('speechSynthesis' in window) || !text) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language === 'Hindi' ? 'hi-IN' : language === 'Hinglish' ? 'en-IN' : 'en-IN'
    utterance.rate = 0.91
    utterance.onstart = () => { stopButton.hidden = false }
    utterance.onend = () => { stopButton.hidden = true }
    utterance.onerror = () => { stopButton.hidden = true }
    stopButton.hidden = false
    window.speechSynthesis.speak(utterance)
  }

  stopButton.addEventListener('click', stopSpeech)
  window.addEventListener('pagehide', stopSpeech)

  function showKeyboard(input) {
    activeInput = input
    keyboard.hidden = false
    keyboardBackdrop.hidden = false
    document.body.classList.add('keyboard-open')
    requestAnimationFrame(() => {
      const container = input.closest('.content-scroll')
      const keyboardTop = keyboard.getBoundingClientRect().top
      const overflow = input.getBoundingClientRect().bottom - keyboardTop + 12
      if (container && overflow > 0) container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + overflow)
    })
  }

  function hideKeyboard(refocus = false) {
    keyboard.hidden = true
    keyboardBackdrop.hidden = true
    document.body.classList.remove('keyboard-open')
    if (refocus && activeInput) activeInput.focus({ preventScroll: true })
  }

  $$('.keyboard-target').forEach((input) => {
    input.addEventListener('focus', () => showKeyboard(input))
  })
  $('#keyboardDone').addEventListener('click', () => hideKeyboard())
  keyboardBackdrop.addEventListener('click', () => hideKeyboard())

  function insertAtCaret(input, value) {
    if (!input || input.disabled) return
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    if (value === 'backspace') {
      if (start === end && start > 0) input.setRangeText('', start - 1, end, 'end')
      else input.setRangeText('', start, end, 'end')
    } else {
      input.setRangeText(value, start, end, 'end')
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus({ preventScroll: true })
  }

  keyboard.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) event.preventDefault()
  })
  keyboard.addEventListener('click', (event) => {
    const button = event.target.closest('[data-key]')
    if (!button || !activeInput) return
    const key = button.dataset.key
    if (key === 'shift') {
      isShifted = !isShifted
      $$('[data-key]', keyboard).forEach((item) => {
        if (/^[a-z]$/.test(item.dataset.key)) item.textContent = isShifted ? item.dataset.key.toUpperCase() : item.dataset.key.toLowerCase()
      })
      return
    }
    if (key === '123') {
      showToast('Use your device keyboard for numbers and symbols.')
      return
    }
    if (key === 'enter') {
      if (activeInput.tagName === 'TEXTAREA') insertAtCaret(activeInput, '\n')
      else hideKeyboard()
      return
    }
    insertAtCaret(activeInput, key === 'backspace' ? 'backspace' : isShifted && /^[a-z]$/.test(key) ? key.toUpperCase() : key)
    if (isShifted) {
      isShifted = false
      $$('[data-key]', keyboard).forEach((item) => { if (/^[A-Z]$/.test(item.textContent)) item.textContent = item.textContent.toLowerCase() })
    }
  })

  function speechLanguage() {
    const language = $('#assistantLanguage')?.value || 'English'
    return language === 'Hindi' ? 'hi-IN' : language === 'Hinglish' ? 'en-IN' : 'en-IN'
  }

  function stopRecognition() {
    if (!recognition) return
    try { recognition.stop() } catch {}
    recognition = null
  }

  function startRecognition(target, assistant = false) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      showToast('Voice input is not available in this browser. You can type instead.')
      return
    }
    if (recognition) stopRecognition()
    resumeAudio()
    recognitionTarget = target
    const instance = new Recognition()
    recognition = instance
    instance.lang = speechLanguage()
    instance.interimResults = true
    instance.continuous = false
    instance.maxAlternatives = 1
    const micButton = assistant ? $('#assistantMic') : target?.closest('.input-shell')?.querySelector('[data-mic]')
    if (micButton) micButton.classList.add('listening')
    if (assistant) {
      $('#voiceTitle').textContent = 'Listening…'
      $('#voiceHint').textContent = 'Speak your question, then pause'
    }
    instance.onresult = (event) => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index++) transcript += event.results[index][0].transcript
      if (recognitionTarget) {
        if (recognitionTarget.tagName === 'TEXTAREA') recognitionTarget.value = transcript
        else recognitionTarget.value = transcript
        recognitionTarget.dispatchEvent(new Event('input', { bubbles: true }))
        if (assistant) $('#voiceHint').textContent = transcript
      }
    }
    instance.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') showToast(`Voice input: ${event.error}. You can type instead.`)
    }
    instance.onend = () => {
      if (micButton) micButton.classList.remove('listening')
      const finalTarget = recognitionTarget
      recognition = null
      recognitionTarget = null
      if (assistant) {
        const transcript = finalTarget?.value?.trim()
        $('#voiceTitle').textContent = transcript ? 'Got it!' : 'Tap to speak'
        $('#voiceHint').textContent = transcript || 'I’m listening when you’re ready'
        if (transcript) {
          const form = $('.question-form[data-mode="assistant"]')
          if (form) submitForm(form)
        }
      }
    }
    try { instance.start() } catch { showToast('Could not start the microphone. Check browser microphone permission.') }
  }

  $('#assistantMic').addEventListener('click', () => {
    const input = $('.question-form[data-mode="assistant"] textarea')
    startRecognition(input, true)
  })
  $$('[data-mic]').forEach((button) => button.addEventListener('click', () => {
    const input = button.closest('.input-shell')?.querySelector('input, textarea')
    startRecognition(input)
  }))

  $$('.nav-item[data-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.tab
    $$('.module').forEach((module) => {
      const active = module.id === `tab-${tab}`
      module.hidden = !active
      module.classList.toggle('active', active)
    })
    $$('.nav-item[data-tab]').forEach((item) => {
      const active = item === button
      item.classList.toggle('active', active)
      item.setAttribute('aria-selected', String(active))
    })
    $('#currentCrumb').textContent = button.querySelector('span:nth-child(2)').textContent
    hideKeyboard()
    stopSpeech()
  }))

  $$('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
    const input = $('.question-form[data-mode="assistant"] textarea')
    input.value = button.dataset.prompt
    input.dispatchEvent(new Event('input', { bubbles: true }))
    submitForm($('.question-form[data-mode="assistant"]'))
  }))

  function makePrompt(form) {
    const data = new FormData(form)
    const mode = form.dataset.mode
    if (mode === 'assistant' || mode === 'education') {
      const question = String(data.get('question') || '').trim()
      if (!question) return ''
      return mode === 'education' && data.get('detailed') ? `${question}\nPlease include useful context while keeping the answer within 4–6 lines.` : question
    }
    if (mode === 'career') return `Academic background: ${data.get('background') || 'not specified'}\nInterests and hobbies: ${data.get('interests') || 'not specified'}\nCareer goals: ${data.get('goals') || 'open to suggestions'}\nSuggest a realistic, step-by-step career path.`
    if (mode === 'interview') return `Create three interview questions with compact model answers for: ${data.get('topic') || ''}. Keep everything in 4–6 concise lines.`
    if (mode === 'scholarships') return `Suggest scholarship categories and official places to check, based on: student type ${data.get('studentType')}; stream ${data.get('stream')}; interest ${data.get('interest') || 'not specified'}; academic performance ${data.get('performance')}; financial need ${data.get('need')}; country ${data.get('country') || 'not specified'}. Clearly ask the student to verify eligibility and deadlines on official sites.`
    return ''
  }

  function resultElement(form) {
    return form.closest('.two-column')?.querySelector('[data-result]') || $('#responseBody')
  }

  function setStatus(form, message, state = '') {
    const status = form.closest('.two-column')?.querySelector('[data-status]') || $('#responseStatus')
    if (!status) return
    status.textContent = message
    status.className = `response-status ${state}`
  }

  function renderAnswer(target, answer) {
    target.replaceChildren()
    const text = document.createElement('p')
    text.className = 'answer-lines'
    text.textContent = answer
    target.append(text)
  }

  async function submitForm(form) {
    if (!form) return
    const prompt = makePrompt(form)
    if (!prompt) {
      showToast('Add a little detail first, then ask Mitra.')
      return
    }
    const submit = form.querySelector('[type="submit"]')
    const previousLabel = submit?.innerHTML
    if (submit) { submit.disabled = true; submit.textContent = 'Thinking…' }
    setStatus(form, 'THINKING', 'loading')
    const target = resultElement(form)
    target.replaceChildren()
    const waiting = document.createElement('p')
    waiting.className = 'answer-lines'
    waiting.textContent = 'Mitra is thinking through your question…'
    target.append(waiting)
    hideKeyboard()
    stopSpeech()
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: form.dataset.mode, prompt, language: $('#assistantLanguage')?.value || 'English' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'The request could not be completed.')
      currentAnswer = payload.answer
      renderAnswer(target, payload.answer)
      setStatus(form, 'READY')
      if (form.dataset.mode === 'assistant') $('#responseActions').hidden = false
      speak(payload.answer, $('#assistantLanguage')?.value || 'English')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong. Try again.'
      target.replaceChildren()
      const errorText = document.createElement('p')
      errorText.className = 'answer-lines'
      errorText.textContent = message
      target.append(errorText)
      setStatus(form, 'OFFLINE', 'error')
      showToast(message)
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = previousLabel }
    }
  }

  $$('form[data-mode]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault()
    submitForm(form)
  }))

  $('#speakAgain').addEventListener('click', () => speak(currentAnswer, $('#assistantLanguage').value))
  $('#copyAnswer').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(currentAnswer); showToast('Answer copied.') }
    catch { showToast('Clipboard permission is not available in this browser.') }
  })

  function percentageDbm(percent) {
    return Math.round(-100 + Math.max(0, Math.min(100, percent)) * 0.5)
  }

  $$('[data-scan]').forEach((button) => button.addEventListener('click', async () => {
    const kind = button.dataset.scan
    const result = $(`#${kind}Results`)
    const label = button.innerHTML
    button.disabled = true
    button.innerHTML = 'Scanning…'
    result.replaceChildren()
    const loading = document.createElement('div')
    loading.className = 'scan-empty'
    loading.textContent = 'Looking for nearby devices…'
    result.append(loading)
    try {
      const response = await fetch(`/api/${kind}/scan`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'The scan could not be completed.')
      result.replaceChildren()
      const entries = kind === 'wifi' ? payload.networks : payload.devices
      if (!entries?.length) {
        const empty = document.createElement('div')
        empty.className = 'scan-empty'
        empty.textContent = 'No devices found nearby. Try again in a moment.'
        result.append(empty)
      }
      entries?.forEach((entry) => {
        const row = document.createElement('div')
        row.className = 'scan-row'
        const dot = document.createElement('i')
        dot.className = 'network-dot'
        const name = document.createElement('strong')
        name.textContent = kind === 'wifi' ? entry.ssid : entry.name
        const detail = document.createElement('small')
        detail.textContent = kind === 'wifi' ? `~${percentageDbm(entry.signal)} dBm · ${entry.security}${entry.connected ? ' · connected' : ''}` : entry.address
        row.append(dot, name, detail)
        result.append(row)
      })
    } catch (error) {
      result.replaceChildren()
      const message = document.createElement('div')
      message.className = 'scan-empty'
      message.textContent = error instanceof Error ? error.message : 'The scanner is unavailable.'
      result.append(message)
    } finally {
      button.disabled = false
      button.innerHTML = label
    }
  }))

  $$('[data-move]').forEach((button) => button.addEventListener('click', () => {
    $$('[data-move]').forEach((item) => item.classList.toggle('active', item === button))
    const movement = button.dataset.move
    $('#movementStatus').textContent = movement.toUpperCase()
    $('#movementHint').textContent = movement === 'Stop' ? 'Movement test stopped.' : `${movement} command selected for the local control test.`
    if (movement === 'Stop') setTimeout(() => button.classList.remove('active'), 700)
  }))

  async function checkStatus() {
    const stt = window.SpeechRecognition || window.webkitSpeechRecognition
    $('#sttStatus').textContent = stt ? 'Available in this browser' : 'Not available in this browser'
    $('#ttsStatus').textContent = 'speechSynthesis' in window ? 'Available in this browser' : 'Not available in this browser'
    try {
      const response = await fetch('/api/health')
      const status = await response.json()
      $('#apiStatus').textContent = status.groqConfigured ? `Connected · ${status.model}` : 'Backend online · Groq key needed'
    } catch {
      $('#apiStatus').textContent = 'Flask API not available on this host'
    }
  }
  checkStatus()

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideKeyboard()
      stopSpeech()
    }
    if (event.key === 'Enter' && event.target.matches('input.keyboard-target') && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      event.target.closest('form')?.requestSubmit()
    }
  })
})()