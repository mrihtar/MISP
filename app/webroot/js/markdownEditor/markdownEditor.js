'use strict';

var debounceDelay = 50, slowDebounceDelay = 3000;
var cache_matrix = {}, cache_eventgraph = {};
var renderTimer, scrollTimer, attackMatrixTimer, eventgraphTimer;
var scrollMap;
var $splitContainer, $editorContainer, $rawContainer, $viewerContainer, $resizableHandle, $autocompletionCB, $syncScrollCB, $autoRenderMarkdownCB, $topBar, $lastModifiedField
var $editor, $viewer, $raw
var $saveMarkdownButton, $mardownViewerToolbar
var loadingSpanAnimation = '<span id="loadingSpan" class="fa fa-spin fa-spinner" style="margin-left: 5px;"></span>';

var contentChanged = false
var defaultMode = 'viewer'
var currentMode
var splitEdit = true
var noEditorScroll = false // Necessary as onscroll cannot be unbound from CM
$(document).ready(function() {
    $splitContainer = $('.split-container')
    $editorContainer = $('#editor-container')
    $viewerContainer = $('#viewer-container')
    $rawContainer = $('div.raw-container')
    $resizableHandle = $('#resizable-handle')
    $editor = $('#editor')
    $viewer = $('#viewer')
    $raw = $('#raw')
    $mardownViewerToolbar = $('#mardown-viewer-toolbar')
    $saveMarkdownButton = $('#saveMarkdownButton')
    $autocompletionCB = $('#autocompletionCB')
    $syncScrollCB = $('#syncScrollCB')
    $autoRenderMarkdownCB = $('#autoRenderMarkdownCB')
    $topBar = $('#top-bar')
    $lastModifiedField = $('#lastModifiedField')

    initMarkdownIt()
    if (canEdit) {
        initCodeMirror()
        toggleSaveButton(false)
    }
    setMode(defaultMode)
    if (canEdit) {
        setEditorData(originalRaw);

        $editorContainer.resizable({
            handles: {
                e: $resizableHandle
            },
            grid: 50,
            minWidth: 300,
            maxWidth: window.innerWidth -220 - 300,
            stop: function() {
                cm.refresh()
                scrollMap = null;
            },
            helper: 'ui-resizable-helper'
        })
    }

    renderMarkdown()

    if (canEdit) {
        $editorContainer.on('touchstart mouseover', function () {
            noEditorScroll = false
            $viewerContainer.off('scroll');
            cm.on('scroll', function(event) {
                if (!noEditorScroll) {
                    doScroll(syncResultScroll)
                }
            });
        });

        $viewerContainer.on('touchstart mouseover', function () {
            noEditorScroll = true
            $viewerContainer.on('scroll', function() {
                doScroll(syncSrcScroll)
            });
        });

        if (typeof cmCustomSetup === 'function') {
            cmCustomSetup()
        }
        if (typeof insertCustomToolbarButtons === 'function') {
            insertCustomToolbarButtons()
        }

        refreshLastUpdatedField()
        $(window).bind('beforeunload', function(e){
            if (!contentChanged) {
                return undefined;
            }
            (e || window.event).returnValue = confirmationMessageUnsavedChanges; //Gecko + IE
            return confirmationMessageUnsavedChanges; //Gecko + Webkit, Safari, Chrome etc.
        })
    }
})

function initMarkdownIt() {
    var mdOptions = {
        highlight: function (str, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(lang, str, true).value;
                } catch (__) {}
            }
            return ''; // use external default escaping
        }
    }
    md = window.markdownit('default', mdOptions);
    md.disable([ 'link', 'image' ])
    md.renderer.rules.table_open = function () {
        return '<table class="table table-striped">\n';
    };
    if (typeof markdownItCustomRules === 'function') {
        markdownItCustomRules()
    }
}

function initCodeMirror() {
    var cmOptions = {
        mode: 'markdown',
        theme:'default',
        lineNumbers: true,
        indentUnit: 4,
        showCursorWhenSelecting: true,
        lineWrapping: true,
        scrollbarStyle: 'overlay',
        extraKeys: {
            "Esc": function(cm) {
                console.log('<esc>')
            },
            "Ctrl-Space": "autocomplete",
            "Ctrl-B": function() { replacementAction('bold') },
            "Ctrl-I": function() { replacementAction('italic') },
            "Ctrl-H": function() { replacementAction('heading') },
            "Ctrl-M": function() { replacementAction('element') },
        },
        hintOptions: {
            completeSingle: false
        },
    }
    if (typeof cmCustomHints === 'function') {
        cmOptions['hintOptions']['hint'] = cmCustomHints
    }
    cm = CodeMirror.fromTextArea($editor[0], cmOptions);
    cm.on('changes', function(cm, event) {
        if (event[0].origin !== 'setValue') {
            invalidateContentCache()
        }
    })
    cm.on("keyup", function (cm, event) {
        if (!cm.state.completionActive && /*Enables keyboard navigation in autocomplete list*/
            event.keyCode != 13 &&        /*Enter - do not open autocomplete list just after item has been selected in it*/ 
            $autocompletionCB.prop('checked')) {
            cm.showHint()
        }
    });
}

function toggleSaveButton(enabled) {
    $saveMarkdownButton
        .prop('disabled', !enabled)
}

function toggleLoadingInSaveButton(saving) {
    toggleSaveButton(!saving)
    if (saving) {
        $saveMarkdownButton.append(loadingSpanAnimation);
    } else {
        $saveMarkdownButton.find('#loadingSpan').remove();
    }
}

function invalidateContentCache() {
    contentChanged = true
    toggleSaveButton(true)
    $lastModifiedField.addClass('label-important').text(changeDetectedMessage)
}

function revalidateContentCache() {
    contentChanged = false
    toggleSaveButton(false)
    $lastModifiedField.removeClass('label-important')
}

function refreshLastUpdatedField() {
    $lastModifiedField.text(moment(parseInt(lastModified)).fromNow())
}

function sanitizeObject(obj) {
    var newObj = {}
    for (var key of Object.keys(obj)) {
        var newVal = $('</p>').text(obj[key]).html()
        newObj[key] = newVal
    }
    return newObj
}

function hideAll() {
    $rawContainer.hide()
    $editorContainer.hide()
    $viewerContainer.hide()
    $resizableHandle.hide()
}

function setMode(mode) {
    currentMode = mode
    $mardownViewerToolbar.find('button').removeClass('btn-inverse')
    $mardownViewerToolbar.find('button[data-togglemode="' + mode + '"]').addClass('btn-inverse')
    hideAll()
    $editorContainer.css('width', '');
    if (mode == 'raw') {
        $rawContainer.show()
    }
    if (mode == 'splitscreen') {
        $resizableHandle.show()
        $splitContainer.addClass('split-actif')
    } else {
        $resizableHandle.hide()
        $splitContainer.removeClass('split-actif')
    }
    if (mode == 'viewer' || mode == 'splitscreen') {
        $viewerContainer.show()
    }
    if (mode == 'editor' || mode == 'splitscreen') {
        $editorContainer.show({
            duration: 0,
            complete: function() {
                cm.refresh()
                // Make sure to build the scrollmap after the rendering
                setTimeout(function() {
                    scrollMap = buildScrollMap() 
                }, 500);
            }
        })
    }
}

function getEditorData() {
    return cm !== undefined ? cm.getValue() : originalRaw
}

function setEditorData(data) {
    cm.setValue(data)
}

function saveMarkdown() {
    if (modelNameForSave === undefined || markdownModelFieldNameForSave === undefined) {
        console.log('Model or field not defined. Save not possible')
        return
    }
    if (!confirm(saveConfirmMessage)) {
        return
    }
    var url = baseurl + "/eventReports/edit/" + reportid
    fetchFormDataAjax(url, function(formHTML) {
        $('body').append($('<div id="temp" style="display: none"/>').html(formHTML))
        var $tmpForm = $('#temp form')
        var formUrl = $tmpForm.attr('action')
        $tmpForm.find('[name="data[' + modelNameForSave + '][' + markdownModelFieldNameForSave + ']"]').val(getEditorData())
        
        $.ajax({
            data: $tmpForm.serialize(),
            beforeSend: function() {
                toggleLoadingInSaveButton(true)
                $editor.prop('disabled', true);
            },
            success:function(report, textStatus) {
                showMessage('success', saveSuccessMessage);
                if (report) {
                    report = JSON.parse(report)
                    if (report[0].EventReport !== undefined) {
                        lastModified = report[0].EventReport.timestamp + '000'
                        refreshLastUpdatedField()
                        originalRaw = report[0].EventReport.content
                        revalidateContentCache()
                    }
                }
            },
            error: function(jqXHR, textStatus, errorThrown) {
                showMessage('fail', saveFailedMessage + ': ' + errorThrown);
            },
            complete:function() {
                $('#temp').remove();
                toggleLoadingInSaveButton(false)
                $editor.prop('disabled', false);
            },
            type:"post",
            url: formUrl
        })
    })
}

function downloadMarkdown(type) {
    var content, fileType, baseName, extension
    if (type == 'pdf') {
        if (currentMode != 'viewer' && currentMode != 'splitscreen') {
            setMode('viewer')
            setTimeout(function (){ // let the parser render the document
                if (confirm(savePDFConfirmMessage)) {
                    window.print()
                }
            }, 300);
        } else {
            if (confirm(savePDFConfirmMessage)) {
                window.print()
            }
        }
        return
    } else if (type == 'text') {
        content = getEditorData()
        baseName = 'event-report-' + (new Date()).getTime()
        extension = 'md'
        fileType = 'text/markdown'
    } else if (type == 'text-gfm') {
        content = getEditorData()
        if (typeof markdownGFMSubstitution === 'function') {
            content = markdownGFMSubstitution(content)
        }
        baseName = 'event-report-' + (new Date()).getTime()
        extension = 'md'
        fileType = 'text/markdown'
    }
    var filename = baseName + '.' + extension
    var blob = new Blob([content], {
        type: fileType
    })
    saveAs(blob, filename)
}

function showHelp() {
    $('#genericModal.markdown-modal-helper').modal();
}

function renderMarkdown() {
    var toRender = getEditorData()
    var result = md.render(toRender)
    scrollMap = null
    $viewer.html(result)
    postRenderingAction()
}

function doRender() {
    if ($autoRenderMarkdownCB.prop('checked')) {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderMarkdown, debounceDelay);
    }
}

function registerListener() {
    if (typeof markdownCustomPostRenderingListener === 'function') {
        markdownCustomPostRenderingListener()
    }
}

function postRenderingAction() {
    registerListener()
    if (typeof markdownCustomPostRenderingActions === 'function') {
        markdownCustomPostRenderingActions()
    }
}

function replacementAction(action) {
    var customReplacementTriggered = false
    if (typeof customReplacementActions === 'function') {
        customReplacementTriggered = customReplacementActions(action)
    }
    if (!customReplacementTriggered) {
        baseReplacementAction(action)
    }
}

function baseReplacementAction(action) {
    var start = cm.getCursor('start')
    var end = cm.getCursor('end')
    var content = cm.getRange(start, end)
    var replacement = content
    var setCursorTo = false

    switch (action) {
        case 'bold':
            replacement = '**' + content + '**'
            break;
        case 'italic':
            replacement = '*' + content + '*'
            break;
        case 'heading':
            start.ch = 0
            replacement = cm.getRange({line: start.line, ch: 0}, {line: start.line, ch: 1}) == '#' ? '#' : '# '
            end = null
            break;
        case 'strikethrough':
            replacement = '~~' + content + '~~'
            break;
        case 'list-ul':
            start.ch = 0
            var currentFirstChar = cm.getRange({line: start.line, ch: 0}, {line: start.line, ch: 2})
            if (currentFirstChar == '* ') {
                replacement = ''
                end.ch = 2
            } else {
                replacement = '* '
                end = null
            }
            break;
        case 'list-ol':
            start.ch = 0
            var currentFirstChar = cm.getRange({line: start.line, ch: 0}, {line: start.line, ch: 3})
            if (currentFirstChar == '1. ') {
                replacement = ''
                end.ch = 3
            } else {
                replacement = '1. '
                end = null
            }
            break;
        case 'quote':
            start.ch = 0
            var currentFirstChar = cm.getRange({line: start.line, ch: 0}, {line: start.line, ch: 2})
            if (currentFirstChar == '> ') {
                replacement = ''
                end.ch = 2
            } else {
                replacement = '> '
                end = null
            }
            break;
        case 'code':
            cm.replaceRange('\n```', {line: start.line - 1})
            cm.replaceRange('\n```', {line: end.line + 1})
            cm.setCursor(start.line + 1)
            cm.focus()
            return;
        case 'table':
            var tableTemplate = '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text     | Text     |\n'
            var lineContent = cm.getLine(start.line)
            if (lineContent != '') {
                tableTemplate = '\n' + tableTemplate
            }
            cm.replaceRange(tableTemplate, {line: start.line + 1})
            var startSelection = start.line + 1
            if (lineContent != '') {
                startSelection++
            }
            cm.setSelection({line: startSelection, ch: 2}, {line: startSelection, ch: 10})
            cm.focus()
            return;
        default:
            break;
    }
    cm.replaceRange(replacement, start, end)
    if (setCursorTo !== false) {
        cm.setCursor(setCursorTo.line, setCursorTo.ch)
    }
    cm.focus()
}

function insertTopToolbarSection() {
    $topBar.append($('<i />').addClass('top-bar-separator'))
}

function insertTopToolbarButton(FAClass, replacement) {
    $topBar.append(
        $('<span />').addClass('useCursorPointer icon fa fa-' + FAClass)
            .click(function() {
            replacementAction(replacement)
        })
    )
}

// Inject line numbers for sync scroll. Notes:
//
// - We track only headings and paragraphs on first level. That's enough.
// - Footnotes content causes jumps. Level limit filter it automatically.
function injectLineNumbers(tokens, idx, options, env, slf) {
    var line;
    if (tokens[idx].map && tokens[idx].level === 0) {
        line = tokens[idx].map[0];
        tokens[idx].attrJoin('class', 'line');
        tokens[idx].attrSet('data-line', String(line+1));
    }
    return slf.renderToken(tokens, idx, options, env, slf);
}


// Build offsets for each line (lines can be wrapped)
// That's a bit dirty to process each line everytime, but ok for demo.
// Optimizations are required only for big texts.
// Source: https://github.com/markdown-it/markdown-it/blob/master/support/demo_template/index.js
function buildScrollMap() {
    var i, offset, nonEmptyList, pos, a, b, lineHeightMap, linesCount,
    acc, sourceLikeDiv, textarea = $(cm.getWrapperElement()),
    _scrollMap;
    
    sourceLikeDiv = $('<div />').css({
        position: 'absolute',
        visibility: 'hidden',
        height: 'auto',
        width: textarea[0].clientWidth,
        'font-size': textarea.css('font-size'),
        'font-family': textarea.css('font-family'),
        'line-height': textarea.css('line-height'),
        'white-space': textarea.css('white-space')
    }).appendTo('body');
    
    offset = $viewerContainer.scrollTop() - $viewerContainer.offset().top;
    if ($(cm.getWrapperElement()).closest('.modal').length > 0) { // inside a modal
        offset -= 20
    }
    _scrollMap = [];
    nonEmptyList = [];
    lineHeightMap = [];
    
    acc = 0;
    cm.eachLine(function(line) {
        var h, lh;
        lineHeightMap.push(acc)
        if (line.text.length === 0) {
            acc++
            return
        }
        sourceLikeDiv.text(line.text);
        h = parseFloat(sourceLikeDiv.css('height'));
        lh = parseFloat(sourceLikeDiv.css('line-height'));
        acc += Math.round(h / lh);
    })
    sourceLikeDiv.remove();
    lineHeightMap.push(acc);
    linesCount = acc;
    
    for (i = 0; i < linesCount; i++) { _scrollMap.push(-1); }
    
    nonEmptyList.push(0);
    _scrollMap[0] = 0;
    
    $viewerContainer.find('.line').each(function (n, el) {
        var $el = $(el), t = $el.data('line');
        if (t === '') { return; }
        t = lineHeightMap[t];
        if (t !== 0) { nonEmptyList.push(t); }
        _scrollMap[t] = Math.round($el.offset().top + offset);
    });

    nonEmptyList.push(linesCount);
    _scrollMap[linesCount] = $viewerContainer[0].scrollHeight;
    
    pos = 0;
    for (i = 1; i < linesCount; i++) {
        if (_scrollMap[i] !== -1) {
            pos++;
            continue;
        }
        
        a = nonEmptyList[pos];
        b = nonEmptyList[pos + 1];
        _scrollMap[i] = Math.round((_scrollMap[b] * (i - a) + _scrollMap[a] * (b - i)) / (b - a));
    }
    
    return _scrollMap;
}

function doScroll(fun) {
    if ($syncScrollCB.prop('checked')) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(fun, debounceDelay);
    }
}

// Synchronize scroll position from source to result
var syncResultScroll = function () {
    var lineNo = Math.ceil(cm.getScrollInfo().top/cm.defaultTextHeight());
    if (!scrollMap) { scrollMap = buildScrollMap(); }
    var posTo = scrollMap[lineNo];
    $viewerContainer.stop(true).animate({
        scrollTop: posTo
    }, 100, 'linear');
}

// Synchronize scroll position from result to source
var syncSrcScroll = function () {
    var resultHtml = $viewerContainer,
    scrollTop  = resultHtml.scrollTop(),
    lines,
    i,
    line;
    
    if (!scrollMap) { scrollMap = buildScrollMap(); }
    
    lines = Object.keys(scrollMap);
    
    if (lines.length < 1) {
        return;
    }
    
    line = lines[0];
    
    for (i = 1; i < lines.length; i++) {
        if (scrollMap[lines[i]] < scrollTop) {
            line = lines[i];
            continue;
        }
        break;
    }
    cm.scrollTo(0, line*cm.defaultTextHeight())
}