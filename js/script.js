document.addEventListener('DOMContentLoaded', function () {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const filesContainer = document.getElementById('files');
    const mergeButton = document.getElementById('mergeButton');
    const spinnerWrapper = document.getElementById('spinner-wrapper'); // Reference the new wrapper
    const spinner = spinnerWrapper.querySelector('.spinner');
    const mergeStatus = spinnerWrapper.querySelector('.merge-status');    
    const previewButton = document.getElementById('previewButton');
    const downloadButton = document.getElementById('downloadButton');

    const pdfFiles = [];
    let dragSrcIndex = null;
    let mergedPdfUrl = null;

    // Initially, ensure the spinner is hidden
    spinner.classList.add('hidden');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(Array.from(e.dataTransfer.files));
    });

    fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files)));

    function handleFiles(files) {
        const pdfOnly = files.filter(f => f.type === 'application/pdf');
        if (pdfOnly.length !== files.length) {
            alert('Only PDF files are allowed.');
            fileInput.value = '';
            return;
        }

        // Limit the number of files to 12
        if (pdfFiles.length + pdfOnly.length > 12) {
            alert('You can upload a maximum of 12 files.');
            fileInput.value = '';
            return;
        }

        pdfOnly.forEach(file => {
            pdfFiles.push(file);
        });
        renderFiles();
        updateUI();

        // THIS LINE IS IMPORTANT
        fileInput.value = '';
    }

    function renderFiles() {
        filesContainer.innerHTML = '';
        pdfFiles.forEach((file, index) => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.setAttribute('draggable', true);
            li.dataset.index = index;

            li.addEventListener('dragstart', (e) => {
                dragSrcIndex = Number(li.dataset.index);
                e.dataTransfer.effectAllowed = 'move';
            });
            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                li.classList.add('drag-over-item');
            });
            li.addEventListener('dragleave', () => li.classList.remove('drag-over-item'));
            li.addEventListener('drop', (e) => {
                e.preventDefault();
                const dropIndex = Number(li.dataset.index);
                li.classList.remove('drag-over-item');
                reorderFiles(dragSrcIndex, dropIndex);
            });

            const pdfIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            pdfIcon.classList.add('pdf-icon');
            pdfIcon.setAttribute('viewBox', '0 0 24 24');
            pdfIcon.setAttribute('fill', 'none');
            pdfIcon.innerHTML = `
                <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M7 15h10M7 11h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            `;

            const fileName = document.createElement('span');
            fileName.textContent = file.name;

            const removeButton = document.createElement('button');
            removeButton.className = 'remove-file';
            removeButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            removeButton.onclick = () => {
                pdfFiles.splice(index, 1);
                renderFiles();
                updateUI();
            };

            li.append(pdfIcon, fileName, removeButton);
            filesContainer.appendChild(li);
        });
    }

    function reorderFiles(from, to) {
        if (from === to) return;
        const [moved] = pdfFiles.splice(from, 1);
        pdfFiles.splice(to, 0, moved);
        renderFiles();
    }

    function updateUI() {
        fileList.classList.toggle('hidden', pdfFiles.length === 0);
        mergeButton.disabled = pdfFiles.length < 2;
        previewButton.disabled = true;
        downloadButton.disabled = true;
    }

    // Detect if the browser supports Web Workers
    function isWorkerSupported() {
        return typeof Worker !== "undefined";
    }

    mergeButton.addEventListener('click', () => {
        if (pdfFiles.length < 2) return;
    
        spinnerWrapper.classList.remove('hidden');
        spinner.classList.remove('hidden');
        mergeStatus.classList.remove('hidden');
        mergeStatus.textContent = "Merging PDFs...";
        mergeButton.disabled = true;
    
        if (isWorkerSupported()) {
            const workerCode = `
                importScripts('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
    
                self.onmessage = async (e) => {
                    try {
                        const filesData = e.data.filesData;
                        const mergedPdf = await PDFLib.PDFDocument.create();
                        const encryptedFiles = [];
    
                        for (const file of filesData) {
                            try {
                                const srcPdf = await PDFLib.PDFDocument.load(file.buffer);
                                const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
                                copiedPages.forEach((page) => mergedPdf.addPage(page));
                            } catch (err) {
                                if (err.message.includes('encrypted')) {
                                    encryptedFiles.push(file.name);
                                } else {
                                    throw err;
                                }
                            }
                        }
    
                        if (encryptedFiles.length > 0) {
                            self.postMessage({ type: 'encrypted', encryptedFiles });
                            return;
                        }
    
                        const mergedBytes = await mergedPdf.save();
                        self.postMessage({ type: 'done', mergedBytes }, [mergedBytes.buffer]);
                    } catch (err) {
                        self.postMessage({ type: 'error', error: err.message });
                    }
                };
            `;
    
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
    
            Promise.all(
                pdfFiles.map(file =>
                    file.arrayBuffer().then(buffer => ({ buffer, name: file.name }))
                )
            ).then(filesData => {
                worker.postMessage({ filesData });
            });
    
            worker.onmessage = (e) => {
                if (e.data.type === 'done') {
                    const mergedBytes = e.data.mergedBytes;
                    const blobPdf = new Blob([mergedBytes], { type: 'application/pdf' });
                    mergedPdfUrl = URL.createObjectURL(blobPdf);
    
                    spinnerWrapper.classList.add('hidden');
                    mergeStatus.textContent = `PDFs merged successfully! preview or download`;
                    setTimeout(() => mergeStatus.classList.add('hidden'), 2000);
    
                    previewButton.disabled = false;
                    downloadButton.disabled = false;
                    mergeButton.disabled = false;
                    worker.terminate();
                } else if (e.data.type === 'encrypted') {
                    spinnerWrapper.classList.add('hidden');
                    spinner.classList.add('hidden');
                    mergeStatus.classList.add('hidden');
    
                    const encryptedFilesList = e.data.encryptedFiles.join(',');
                    // mergeStatus.textContent = `Cannot merge. Encrypted file(s) detected: ${encryptedFilesList}`;

                    mergeStatus.innerHTML = `
                        <div style="
                          position: relative;
                          padding: 16px 20px;
                          background-color: #f8d7da;
                          color: #721c24;
                          border: 1px solid #f5c6cb;
                          border-radius: 8px;
                          font-size: 16px;
                          max-width: 400px;
                          margin: 10px auto;
                          text-align: left;
                        ">
                          <button id="closeStatus" style="
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            background: none;
                            border: none;
                            font-size: 20px;
                            color: red;
                            cursor: pointer;
                            font-weight: bold;
                          ">&times;</button>
                          Encrypted file(s) detected: ${encryptedFilesList}. <br>
                          This is security-first application and hence can not merge encrypted files.
                        </div>
                      `;
                    setTimeout(() => mergeStatus.classList.add('hidden'), 8000);  
                    document.getElementById('closeStatus').addEventListener('click', () => {
                    mergeStatus.classList.add('hidden');
                    });
                    mergeStatus.classList.remove('hidden');
    
                    mergeButton.disabled = false;
                    worker.terminate();
                } else if (e.data.type === 'error') {
                    console.error('Error in worker:', e.data.error);
                    spinnerWrapper.classList.add('hidden');
                    spinner.classList.add('hidden');
                    mergeStatus.textContent = 'Error merging PDFs';
                    setTimeout(() => mergeStatus.classList.add('hidden'), 2000);
    
                    mergeButton.disabled = false;
                    worker.terminate();
                }
                spinner.classList.add('hidden');
            };
        } else {
            mergePDFs(pdfFiles);
        }
    });
    

    function mergePDFs(files) {
        const mergedPdf = PDFLib.PDFDocument.create();

        const filePromises = files.map(file =>
            file.arrayBuffer().then(buffer => PDFLib.PDFDocument.load(buffer))
        );

        Promise.all(filePromises).then(pdfs => {
            pdfs.forEach(pdf => {
                const pages = pdf.getPages();
                pages.forEach(page => {
                    mergedPdf.addPage(page);
                });
            });

            mergedPdf.save().then(mergedBytes => {
                const blobPdf = new Blob([mergedBytes], { type: 'application/pdf' });
                mergedPdfUrl = URL.createObjectURL(blobPdf);

                // Hide the spinner and show success message
                spinnerWrapper.classList.add('hidden');
                mergeStatus.textContent = `PDFs merged successfully! preview or download`;
                setTimeout(() => mergeStatus.classList.add('hidden'), 2000);

                previewButton.disabled = false;
                downloadButton.disabled = false;

                mergeButton.disabled = false; // Re-enable the merge button
            });
        }).catch(err => {
            console.error('Error merging PDFs:', err);
            spinnerWrapper.classList.add('hidden');
            mergeStatus.textContent = 'Error merging PDFs';
            setTimeout(() => mergeStatus.classList.add('hidden'), 2000);

            mergeButton.disabled = false; // Re-enable the merge button
        });
    }

    previewButton.addEventListener('click', () => {
        if (mergedPdfUrl) {
            window.open(mergedPdfUrl, '_blank');
        }
    });

    downloadButton.addEventListener('click', () => {
        if (mergedPdfUrl) {
            const a = document.createElement('a');
            a.href = mergedPdfUrl;
            a.download = 'merged.pdf';
            a.click();
        }
    });
});


document.addEventListener('keydown', function(e) {
    // Block F12
    if (e.key === 'F12') {
        e.preventDefault();
    }

    // Block Ctrl+Shift+I/J/C (Dev Tools)
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
        e.preventDefault();
    }

    // Block Ctrl+U (View Source) – note: not always effective
    if (e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        return false;
    }

    // Block Ctrl+S (Save), Ctrl+P (Print)
    if (e.ctrlKey && ['s', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
    }
});

