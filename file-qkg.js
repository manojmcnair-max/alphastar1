// --- Constants and Global State ---
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSXiRXaJISr4tcW13tBxLXl7heUjDbCyGyyABHPZIrx-m2YqXWP0oyeTw1VL4slZ0dJrrngl3CsvO2z/pub?gid=1269716757&single=true&output=csv';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzD2JKdxqgMuHsu-CvuzfbKzZXe8ryJBOC_mpN9vNdwpG3M702k3_2msUo7s2VrDzcC/exec';
let workOrders = [];

// --- Initial Load ---
// Wait for the DOM to be fully loaded before fetching data
document.addEventListener('DOMContentLoaded', loadFromSheet);

// --- Core Functions: Data Fetching and Rendering ---

/**
 * Fetches work order data from the Google Sheet, parses it, and renders the table.
 */
async function loadFromSheet() {
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.disabled = true;
    refreshBtn.textContent = '🔄 Loading...';

    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.statusText}`);
        }
        const csv = await response.text();
        workOrders = parseCSV(csv);
        renderTable();
        showAlert(`Data loaded successfully! Found ${workOrders.length} work orders.`, 'success');
    } catch (error) {
        console.error('Error loading sheet:', error);
        showAlert(`Failed to load data: ${error.message}`, 'error');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Refresh from Sheet';
    }
}

/**
 * Renders the work orders array into the HTML table.
 */
function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (workOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">No work orders found</td></tr>';
        return;
    }

    tbody.innerHTML = workOrders.map((wo, i) => `
        <tr>
            <td><span class="status-${wo.status.toLowerCase()}">${wo.status}</span></td>
            <td><strong>${wo.aircraft}</strong></td>
            <td style="font-size: 0.8rem;">${wo.woNumber}</td>
            <td style="font-size: 0.8rem;">${wo.description}</td>
            <td>${formatDueDate(wo.dueDate)}</td>
            <td style="font-size: 0.8rem;">${wo.remarks || '-'}</td>
            <td>${formatActionPlan(wo.actionPlan)}</td>
            <td style="font-size: 0.8rem;">
                ${wo.completedBy || '-'}
                ${wo.completedDate ? `<br><small>${wo.completedDate}</small>` : ''}
            </td>
            <td>
                ${wo.status !== 'Completed' ?
                    `<button class="btn btn-success" onclick="openModal(${i})" style="font-size: 0.8rem; padding: 0.5rem;">Complete</button>` :
                    wo.logbookUrl ? `<a href="${wo.logbookUrl}" target="_blank" class="btn btn-primary" style="text-decoration: none; display: inline-block; font-size: 0.8rem; padding: 0.5rem;">📄 PDF</a>` : 'Done'
                }
            </td>
        </tr>
    `).join('');
}


// --- Modal and Form Handling ---

/**
 * Opens the 'Complete Work Order' modal and populates it with data.
 * @param {number} index - The index of the work order in the global array.
 */
function openModal(index) {
    const wo = workOrders[index];
    document.getElementById('completeIndex').value = index;

    document.getElementById('woDetails').innerHTML = `
        <strong>Aircraft:</strong> ${wo.aircraft}<br>
        <strong>W/O Number:</strong> ${wo.woNumber}<br>
        <strong>Description:</strong> ${wo.description}<br>
        <strong>Due:</strong> ${wo.dueDate}<br>
        ${wo.actionPlan && wo.actionPlan !== 'NIL' ? `<strong>Action Plan:</strong> ${wo.actionPlan}<br>` : ''}
    `;

    document.getElementById('completeModal').classList.add('active');
}

/**
 * Closes the modal and resets the form.
 */
function closeModal() {
    document.getElementById('completeModal').classList.remove('active');
    document.getElementById('completeForm').reset();
}

/**
 * Handles the form submission for completing a work order.
 * @param {Event} e - The form submission event.
 */
async function completeWorkOrder(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Uploading...';

    const index = document.getElementById('completeIndex').value;
    const wo = workOrders[index];
    const name = document.getElementById('technicianName').value;
    const file = document.getElementById('logbookFile').files[0];
    const notes = document.getElementById('completionNotes').value;

    if (file.size > 50 * 1024 * 1024) { // 50MB
        showAlert('File too large! Maximum size is 50MB.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '✓ Mark Complete';
        return;
    }

    try {
        const base64 = await fileToBase64(file);
        submitBtn.textContent = '💾 Saving...';

        const data = {
            aircraft: wo.aircraft,
            woNumber: wo.woNumber,
            status: 'Completed',
            completedBy: name,
            completedDate: new Date().toISOString().split('T')[0],
            logbookBase64: base64,
            completionNotes: notes
        };

        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            closeModal();
            showAlert(`Work Order ${wo.woNumber} completed successfully!`, 'success');
            setTimeout(loadFromSheet, 2000);
        } else {
            throw new Error(result.error || 'Failed to complete work order');
        }
    } catch (error) {
        console.error('Error completing work order:', error);
        showAlert(`Error: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '✓ Mark Complete';
    }
}


// --- Utility and Formatting Functions ---

/**
 * Parses a raw CSV string into an array of objects.
 * Handles quoted fields that may contain newlines.
 * @param {string} csv - The raw CSV string.
 * @returns {Array<Object>} An array of work order objects.
 */
function parseCSV(csv) {
    // This custom parser handles newlines inside quoted fields.
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        const nextChar = csv[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentField.trim());
            if (currentRow.length > 1 || currentRow[0]) {
                 rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    // Add the last field and row
    currentRow.push(currentField.trim());
    if (currentRow.length > 1 || currentRow[0]) {
        rows.push(currentRow);
    }

    // Convert rows to order objects, skipping the header (i=1)
    return rows.slice(1).map(row => {
        if (row.length < 4) return null; // Basic validation
        return {
            aircraft: row[0] || '',
            woNumber: row[1] || '',
            description: row[2] || '',
            dueDate: row[3] || '',
            remarks: row[4] || '',
            actionPlan: row[5] || '',
            status: row[6] || 'Pending',
            completedBy: row[7] || '',
            completedDate: row[8] || '',
            logbookUrl: row[9] || '',
            completionNotes: row[10] || ''
        };
    }).filter(Boolean); // Filter out any null entries
}

/**
 * Formats the Due Date cell with badges for AFH/AFL.
 * @param {string} dueDate - The due date string.
 * @returns {string} HTML content for the cell.
 */
function formatDueDate(dueDate) {
    if (!dueDate) return '-';

    let html = '<div class="due-cell">';
    const afhMatch = dueDate.match(/(\d+):(\d+)\s*(?:AFH)?/i);
    const aflMatch = dueDate.match(/(\d+)\s*\(?\s*(AFL|AFC)\s*\)?/i);
    const dateMatch = dueDate.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}-[A-Za-z]{3}-\d{2,4})/);

    if (afhMatch) {
        html += `<div><span class="due-badge badge-afh">AFH</span>${afhMatch[1]}:${afhMatch[2]} hrs</div>`;
    } else if (aflMatch) {
        html += `<div><span class="due-badge badge-afl">AFL</span>${aflMatch[1]} cycles</div>`;
    } else if (dateMatch) {
        html += `<div>${dateMatch[0]}</div>`;
    } else {
        html += dueDate; // Show raw if no pattern matches
    }

    html += '</div>';
    return html;
}

/**
 * Formats the Action Plan cell, highlighting remaining hours/cycles.
 * @param {string} actionPlan - The action plan string.
 * @returns {string} HTML content for the cell.
 */
function formatActionPlan(actionPlan) {
    if (!actionPlan || actionPlan === 'NIL') return '-';

    let html = '<div class="due-cell">';
    const afhRemMatch = actionPlan.match(/(\d+)\s+AFH\s+REMAINING/i);
    const aflRemMatch = actionPlan.match(/(\d+)\s+AF[CL]\s+REMAINING/i);
    const asOfMatch = actionPlan.match(/AS\s+OF\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i);

    let patternMatched = false;

    if (afhRemMatch) {
        const hours = parseInt(afhRemMatch[1], 10);
        const className = hours <= 10 ? 'remaining-critical' : hours <= 30 ? 'remaining-warning' : '';
        html += `<div class="${className}">${hours} AFH rem.</div>`;
        patternMatched = true;
    }
    
    if (aflRemMatch) {
        const cycles = parseInt(aflRemMatch[1], 10);
        const className = cycles <= 5 ? 'remaining-critical' : cycles <= 15 ? 'remaining-warning' : '';
        html += `<div class="${className}">${cycles} AFL rem.</div>`;
        patternMatched = true;
    }

    if (asOfMatch) {
        html += `<div style="font-size: 0.75rem; color: #666; font-style: italic;">as of ${asOfMatch[1]}</div>`;
    }
    
    if (!patternMatched) {
        html += actionPlan; // Show raw if no REMAINING pattern matched
    }

    html += '</div>';
    return html;
}

/**
 * Displays a temporary alert message at the top of the page.
 * @param {string} message - The message to display.
 * @param {string} type - The type of alert ('success' or 'error').
 */
function showAlert(message, type) {
    const container = document.getElementById('alertContainer');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    container.appendChild(alert);

    // Fade out and remove the alert
    setTimeout(() => {
        alert.style.transition = 'opacity 0.5s ease';
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 500);
    }, 5000);
}

/**
 * Converts a file object to a Base64 encoded string.
 * @param {File} file - The file to convert.
 * @returns {Promise<string>} A promise that resolves with the Base64 string.
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}