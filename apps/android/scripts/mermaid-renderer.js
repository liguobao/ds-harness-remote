/* global mermaid */
/**
 * Runs inside the hidden Mermaid WebView after the pinned mermaid build. React Native sends one
 * request at a time through window.renderMermaid; every reply is posted back as JSON.
 *
 * react-native-svg ignores <style>, classes and CSS variables, and its native renderer throws on
 * attribute values it cannot parse (for example a marker orient of auto-start-reverse), which
 * crashes the whole app. The inline copy is therefore rebuilt from an allowlist: known elements
 * only, every attribute value checked against a strict pattern, computed styles copied in as
 * attributes. The untouched SVG is returned too: the full-screen viewer shows it as an <img>.
 */
(function () {
  'use strict'

  var NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i
  var LENGTH = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?(px|em|%)?$/i
  var NUMBER_LIST = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?([\s,]+-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?)*$/i
  var COLOR = /^(none|transparent|currentcolor|#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]+)$/i
  var URL_REF = /^url\(\s*["']?#([A-Za-z0-9_:.-]+)["']?\s*\)$/
  var TRANSFORM = /^((matrix|translate|scale|rotate|skewX|skewY)\(\s*[-\d.e\s,]+\)\s*)+$/
  var PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/
  var ID = /^[A-Za-z0-9_:.-]+$/

  var ELEMENTS = {
    svg: 1, g: 1, path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1,
    text: 1, tspan: 1, defs: 1, marker: 1, linearGradient: 1, radialGradient: 1, stop: 1,
  }
  /** Geometry and structural attributes with the pattern their value must match. */
  var ATTRIBUTES = {
    id: ID, x: LENGTH, y: LENGTH, x1: LENGTH, y1: LENGTH, x2: LENGTH, y2: LENGTH, cx: LENGTH, cy: LENGTH,
    r: LENGTH, rx: LENGTH, ry: LENGTH, fx: LENGTH, fy: LENGTH, width: LENGTH, height: LENGTH, dx: LENGTH, dy: LENGTH,
    offset: LENGTH, points: NUMBER_LIST, viewBox: NUMBER_LIST, d: PATH, transform: TRANSFORM,
    gradientTransform: TRANSFORM, gradientUnits: /^(userSpaceOnUse|objectBoundingBox)$/,
    markerWidth: NUMBER, markerHeight: NUMBER, refX: NUMBER, refY: NUMBER,
    markerUnits: /^(strokeWidth|userSpaceOnUse)$/, orient: /^(auto|-?\d+\.?\d*)$/,
    'stop-color': COLOR, 'stop-opacity': NUMBER,
  }
  /** Presentation properties read from the computed style. */
  var STYLES = {
    fill: 'paint', stroke: 'paint', 'fill-opacity': NUMBER, 'stroke-opacity': NUMBER, opacity: NUMBER,
    'stroke-width': NUMBER, 'stroke-dasharray': /^[\d.]+([\s,]+[\d.]+)*$/, 'stroke-dashoffset': NUMBER,
    'stroke-linecap': /^(butt|round|square)$/, 'stroke-linejoin': /^(miter|round|bevel)$/,
    'stroke-miterlimit': NUMBER, 'fill-rule': /^(nonzero|evenodd)$/, 'font-size': NUMBER,
    'font-weight': /^(normal|bold|[1-9]00)$/, 'font-style': /^(normal|italic)$/,
    'text-anchor': /^(start|middle|end)$/, 'marker-start': 'url', 'marker-end': 'url', 'marker-mid': 'url',
  }
  var HOISTED = /^(defs|marker|linearGradient|radialGradient)$/
  /** Values react-native-svg's Android AlignmentBaseline enum accepts; anything else throws. */
  var BASELINE = /^(baseline|text-bottom|alphabetic|ideographic|middle|central|mathematical|text-top|bottom|center|top|text-before-edge|text-after-edge|before-edge|after-edge|hanging)$/

  function escapeText(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function escapeAttribute(value) {
    return escapeText(value).replace(/"/g, '&quot;')
  }
  function stripPx(value) {
    return value.replace(/(-?\d*\.?\d+)px\b/g, '$1').trim()
  }

  /** Returns a safe attribute value or undefined to drop it. */
  function styleValue(name, raw) {
    var rule = STYLES[name]
    var value = stripPx(raw)
    if (rule === 'url' || rule === 'paint') {
      var ref = URL_REF.exec(value)
      if (ref) return 'url(#' + ref[1] + ')'
      if (rule === 'url') return undefined
      return COLOR.test(value) ? value : undefined
    }
    return rule.test(value) ? value : undefined
  }

  function attributeValue(name, raw) {
    var value = raw.trim()
    if (name === 'orient' && value === 'auto-start-reverse') return 'auto'
    return ATTRIBUTES[name].test(value) ? value : undefined
  }

  function serializeInline(element, out, hoisting, parent) {
    var tag = element.localName
    if (!Object.prototype.hasOwnProperty.call(ELEMENTS, tag)) return
    if (!hoisting && HOISTED.test(tag)) return
    var computed = getComputedStyle(element)
    if (computed.display === 'none' || computed.visibility === 'hidden') return
    out.push('<' + tag)
    if (tag === 'svg') out.push(' xmlns="http://www.w3.org/2000/svg"')
    for (var i = 0; i < element.attributes.length; i += 1) {
      var attribute = element.attributes[i]
      if (!Object.prototype.hasOwnProperty.call(ATTRIBUTES, attribute.name)) continue
      var value = attributeValue(attribute.name, attribute.value)
      if (value !== undefined) out.push(' ' + attribute.name + '="' + escapeAttribute(value) + '"')
    }
    // Presentation attributes on the element are already part of the computed style. A value the
    // element would inherit unchanged from its serialized parent is left out; opacity does not
    // inherit, so only its default is skipped.
    for (var name in STYLES) {
      if (!Object.prototype.hasOwnProperty.call(STYLES, name)) continue
      var styled = computed.getPropertyValue(name)
      if (name === 'opacity' ? styled === '1' : parent !== undefined && parent.getPropertyValue(name) === styled) continue
      var safe = styled ? styleValue(name, styled) : undefined
      if (safe !== undefined) out.push(' ' + name + '="' + escapeAttribute(safe) + '"')
    }
    if (tag === 'text' || tag === 'tspan') {
      var baseline = (element.getAttribute('dominant-baseline') || computed.getPropertyValue('dominant-baseline') || '').trim()
      if (BASELINE.test(baseline)) out.push(' alignment-baseline="' + baseline + '"')
    }
    out.push('>')
    for (var node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) {
        if (tag === 'text' || tag === 'tspan') out.push(escapeText(node.nodeValue || ''))
      } else if (node.nodeType === 1) {
        // react-native-svg does not let marker contents inherit from <marker>, so inside
        // hoisted subtrees every element carries its complete style.
        serializeInline(node, out, hoisting, hoisting ? undefined : computed)
      }
    }
    out.push('</' + tag + '>')
  }

  function inlineSvg(svg, width, height) {
    var out = []
    serializeInline(svg, out)
    // Paint servers and markers placed outside <defs> are drawn as shapes by react-native-svg,
    // so all of them are hoisted into a single <defs> right after the root element opens.
    var defs = []
    var hoisted = svg.querySelectorAll('marker, linearGradient, radialGradient')
    for (var i = 0; i < hoisted.length; i += 1) serializeInline(hoisted[i], defs, true)
    var xml = out.join('')
    if (defs.length > 0) xml = xml.replace(/^(<svg[^>]*>)/, function (open) { return open + '<defs>' + defs.join('') + '</defs>' })
    // The root's own width/height follow the viewBox so the native view can scale it.
    return xml.replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*?>/, function (open) {
      return open.replace(/ (width|height)="[^"]*"/g, '').replace(/>$/, ' width="' + width + '" height="' + height + '">')
    })
  }

  /** Categorical series colors, starting from DeepSeek blue; readable on light and dark cards. */
  var PALETTE = ['#4D6BFE', '#2BA89A', '#E8893A', '#8B63E8', '#3FAE6A', '#D9577E']

  var stage = document.getElementById('stage')
  var post = function (message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)) }
  var configured = ''

  function configure(theme) {
    var key = JSON.stringify(theme)
    if (key === configured) return
    configured = key
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // The default neo look strokes nodes with a gradient; classic keeps plain theme borders.
      look: 'classic',
      deterministicIds: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      // Gantt charts size themselves from their container, which is the 1px hidden WebView.
      gantt: { useWidth: 720 },
      theme: 'base',
      darkMode: theme.dark,
      fontFamily: 'sans-serif',
      themeVariables: {
        darkMode: theme.dark,
        background: theme.background,
        fontSize: '14px',
        fontFamily: 'sans-serif',
        primaryColor: theme.primarySoft,
        primaryBorderColor: theme.primary,
        primaryTextColor: theme.ink,
        secondaryColor: theme.surfaceStrong,
        tertiaryColor: theme.surface,
        lineColor: theme.muted,
        textColor: theme.ink,
        noteBkgColor: theme.surfaceStrong,
        noteTextColor: theme.ink,
        noteBorderColor: theme.border,
        // The base theme derives chart series from surface colors, which vanish on the white card.
        pie1: PALETTE[0], pie2: PALETTE[1], pie3: PALETTE[2], pie4: PALETTE[3], pie5: PALETTE[4], pie6: PALETTE[5],
        pieSectionTextColor: '#FFFFFF',
        pieStrokeColor: theme.background,
        pieOuterStrokeColor: theme.border,
        pieTitleTextColor: theme.ink,
        pieLegendTextColor: theme.ink,
        xyChart: { plotColorPalette: PALETTE.join(','), backgroundColor: theme.surface },
        // Mindmap and timeline sections use the cScale series.
        cScale0: PALETTE[0], cScale1: PALETTE[1], cScale2: PALETTE[2], cScale3: PALETTE[3], cScale4: PALETTE[4], cScale5: PALETTE[5],
        cScaleLabel0: '#FFFFFF', cScaleLabel1: '#FFFFFF', cScaleLabel2: '#FFFFFF', cScaleLabel3: '#FFFFFF', cScaleLabel4: '#FFFFFF', cScaleLabel5: '#FFFFFF',
      },
    })
  }

  function serialize(svg, width, height) {
    var copy = svg.cloneNode(true)
    copy.setAttribute('width', String(width))
    copy.setAttribute('height', String(height))
    copy.removeAttribute('style')
    return new XMLSerializer().serializeToString(copy)
  }

  /** mermaid.render leaves its temporary container behind when parsing fails. */
  function cleanup(renderId) {
    var leftovers = document.querySelectorAll('#' + renderId + ', #d' + renderId)
    for (var i = 0; i < leftovers.length; i += 1) leftovers[i].remove()
    stage.textContent = ''
  }

  window.renderMermaid = function (id, source, theme) {
    var renderId = 'mermaid-' + id
    Promise.resolve().then(function () {
      configure(theme)
      return mermaid.render(renderId, source)
    }).then(function (result) {
      stage.innerHTML = result.svg
      var svg = stage.querySelector('svg')
      if (!svg) throw new Error('empty')
      var box = svg.viewBox && svg.viewBox.baseVal
      var width = Math.ceil(box && box.width ? box.width : svg.getBBox().width)
      var height = Math.ceil(box && box.height ? box.height : svg.getBBox().height)
      if (!(width > 0 && height > 0)) throw new Error('empty')
      var full = serialize(svg, width, height)
      var inline = svg.querySelector('foreignObject') ? undefined : inlineSvg(svg, width, height)
      if (inline === '') inline = undefined
      cleanup(renderId)
      post({ type: 'rendered', id: id, width: width, height: height, svg: full, inline: inline })
    }).catch(function () {
      // Parser errors quote the diagram source, so only the outcome leaves the page.
      cleanup(renderId)
      post({ type: 'error', id: id })
    })
  }

  post({ type: 'ready' })
})()
