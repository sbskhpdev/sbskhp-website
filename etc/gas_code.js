/**
 * 시트가 열릴 때 상단에 '관리 메뉴'를 추가합니다.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📅 캘린더 관리')
    .addItem('지금 캘린더와 동기화', 'syncSheetToCalendar')
    .addToUi();
}

/**
 * 웹사이트에서 데이터를 호출할 때 실행되는 함수 (API)
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const type = (e.parameter.type || 'Education').trim();
    
    // [수정] 신청 내역 조회 로직 (변경된 헤더 대응)
    if (type === 'CheckApplication') {
      const name = (e.parameter.name || "").trim();
      const email = (e.parameter.email || "").trim();
      const sheet = getSheetCaseInsensitive(ss, 'Applications');
      if (!sheet) return createJsonResponse({ error: 'Applications sheet not found' });
      
      const data = sheet.getDataRange().getDisplayValues();
      if (data.length <= 1) return createJsonResponse([]);
      
      const headers = data[0].map(h => h.toString().trim());
      const rows = data.slice(1);
      
      // [수정] 헤더 이름을 기준으로 이름과 이메일 인덱스를 동적으로 찾음
      const nameIdx = headers.indexOf("이름");
      const emailIdx = headers.indexOf("이메일");

      if (nameIdx === -1 || emailIdx === -1) {
        return createJsonResponse({ error: 'Name or Email column not found in Applications sheet' });
      }
      
      const found = rows.filter(row => 
        row[nameIdx].toString().trim() === name && 
        row[emailIdx].toString().trim() === email
      ).map(row => {
        const obj = {};
        headers.forEach((header, i) => {
          if (header) obj[header] = row[i];
        });
        return obj;
      });
      
      return createJsonResponse(found);
    }
    
    // [추가] 캘린더 동기화 요청 처리 (관리자 권한으로 실행됨)
    if (type === 'SyncCalendar') {
      syncSheetToCalendarInternal();
      return createJsonResponse({ success: true, message: 'Calendar sync prioritized' });
    }
    
    let sheet = getSheetCaseInsensitive(ss, type);
    
    if (!sheet) return createJsonResponse({ error: `Sheet named '${type}' not found.` });
    
    const range = sheet.getDataRange();
    if (range.isBlank()) return createJsonResponse([]);
    
    const data = range.getDisplayValues();
    if (data.length === 0) return createJsonResponse([]);
    
    const headers = data[0].map(h => h.toString().trim());
    const rows = data.slice(1);
    
    const result = rows.map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        if (header) obj[header] = row[i];
      });
      return obj;
    });
    
    return createJsonResponse(result);
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  }
}

/**
 * 시트 이름을 대소문자 및 공백 무시하고 찾습니다.
 */
function getSheetCaseInsensitive(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  
  const allSheets = ss.getSheets();
  const searchName = name.toLowerCase().trim();
  return allSheets.find(s => s.getName().toLowerCase().trim() === searchName);
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 웹사이트에서 데이터를 제출할 때 실행되는 함수 (신청서 저장)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // 1. 최대 10초 대기 (동시 신청 방지)
    lock.waitLock(10000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheetCaseInsensitive(ss, 'Applications');
    
    if (!sheet) return createJsonResponse({ error: "Applications sheet not found" });

    const data = JSON.parse(e.postData.contents);
    const type = (data.type || 'Apply').trim();

    // [취소 처리 로직]
    if (type === 'Cancel') {
      const allData = sheet.getDataRange().getValues();
      const headers = allData[0]; // 헤더 행
      let foundRowIndex = -1;

      const searchName = (data.name || "").trim();
      const searchEmail = (data.email || "").trim();
      const searchCourse = (data.course || "").trim();

      // 헤더를 기반으로 필요한 열 인덱스 찾기 (유연하게 대응)
      const nameIdx = headers.indexOf("이름");
      const emailIdx = headers.indexOf("이메일");
      const courseIdx = headers.indexOf("신청과정");
      const statusIdx = headers.indexOf("처리상태");
      const cancelReasonIdx = headers.indexOf("취소사유");

      if (nameIdx === -1 || emailIdx === -1 || courseIdx === -1 || statusIdx === -1) {
        return createJsonResponse({ success: false, error: "시트 구조에 문제가 있습니다. 관리자에게 문의하세요." });
      }

      // 가장 최근(마지막 행) 데이터부터 거꾸로 찾고, 취소 가능 상태들만 처리
      for (let i = allData.length - 1; i >= 1; i--) {
        const rowName = allData[i][nameIdx].toString().trim();
        const rowEmail = allData[i][emailIdx].toString().trim();
        const rowCourse = allData[i][courseIdx].toString().trim();
        const rowStatus = allData[i][statusIdx].toString().trim();

        if (rowName === searchName && rowEmail === searchEmail && rowCourse === searchCourse) {
          // 취소 가능한 상태면 찾음 (승인 대기 추가)
          if (rowStatus === '대기' || rowStatus === '승인' || rowStatus === '승인 대기') {
            foundRowIndex = i + 1; // 1-based index
            break;
          }
        }
      }

      if (foundRowIndex > 0) {
        // 처리상태와 취소사유를 해당 열에 정확히 기록
        sheet.getRange(foundRowIndex, statusIdx + 1).setValue('취소');
        if (cancelReasonIdx !== -1) {
          sheet.getRange(foundRowIndex, cancelReasonIdx + 1).setValue(data.cancelReason || '사용자 요청 취소');
        }
        
        // [추가] 취소 안내 이메일 발송
        sendApplicationEmail({
          name: searchName,
          email: searchEmail,
          course: searchCourse,
          status: '취소',
          reason: data.cancelReason
        });

        return createJsonResponse({ success: true, message: "취소가 성공적으로 처리되었습니다." });
      } else {
        return createJsonResponse({ success: false, error: "해당 신청 내역을 찾을 수 없습니다." });
      }
    }

    // [신청 처리 로직]
    const existingData = sheet.getDataRange().getValues();
    const appHeaders = existingData[0].map(h => h.toString().trim());
    const idxAppName = appHeaders.indexOf("이름");
    const idxAppEmail = appHeaders.indexOf("이메일");
    const idxAppCourse = appHeaders.indexOf("신청과정");
    const idxAppStatus = appHeaders.indexOf("처리상태");

    const applyName = (data.name || "").trim();
    const applyEmail = (data.email || "").trim();
    const applyFullCourse = (data.course || "").trim(); // 예: "AI영상제작 기초 (2회차)"
    const applyCourseBase = applyFullCourse.split(' (')[0].trim(); // 예: "AI영상제작 기초"

    // --- 1. 정원 및 현재 인원 체크 로직 추가 ---
    const eduSheet = getSheetCaseInsensitive(ss, 'Education');
    if (eduSheet) {
      const eduData = eduSheet.getDataRange().getValues();
      const eduHeaders = eduData[0];
      const titleIdx = eduHeaders.indexOf("Title");
      const roundIdx = eduHeaders.indexOf("회차");
      const limitIdx = eduHeaders.indexOf("정원");
      const statusIdx = eduHeaders.indexOf("Status");

      // 신청한 회차 번호 추출 (예: " (2회차)" -> "2")
      const roundMatch = applyFullCourse.match(/\((.*?)회차\)/);
      const applyRoundNum = roundMatch ? roundMatch[1] : "";

      // 해당 교육 과정의 정원 정보 찾기
      const eduRowIndex = eduData.findIndex((r, idx) => {
        if (idx === 0) return false;
        const sTitle = String(r[titleIdx]).trim();
        let sRound = String(r[roundIdx]).trim().replace(/[^0-9]/g, '');
        return sTitle === applyCourseBase && sRound === applyRoundNum;
      });

      if (eduRowIndex !== -1) {
        const eduRowValue = eduData[eduRowIndex];
        const maxCapacity = parseInt(eduRowValue[limitIdx]) || 999;
        
        // 현재 해당 과정을 신청한 인원 카운트 (상태가 '취소', '반려'가 아닌 것)
        const currentCount = existingData.filter((row, idx) => {
          if (idx === 0 || idxAppCourse === -1 || idxAppStatus === -1) return false;
          const rCourse = String(row[idxAppCourse]).trim();
          const rStatus = String(row[idxAppStatus]).trim();
          return rCourse === applyFullCourse && rStatus !== '취소' && rStatus !== '반려';
        }).length;

        if (currentCount >= maxCapacity) {
          // 정원이 찼다면 Status를 '모집마감'으로 변경
          if (statusIdx !== -1) {
            eduSheet.getRange(eduRowIndex + 1, statusIdx + 1).setValue('모집마감');
          }
          return createJsonResponse({ 
            success: false, 
            error: `죄송합니다. 해당 과정은 모집 정원이 초과되어 마감되었습니다.` 
          });
        }
      }
    }
    // ----------------------------------------

    let duplicatedRound = "";
    const isDuplicate = existingData.some((row, idx) => {
      if (idx === 0 || idxAppName === -1 || idxAppEmail === -1 || idxAppCourse === -1 || idxAppStatus === -1) return false;
      
      const rowName = row[idxAppName].toString().trim();
      const rowEmail = row[idxAppEmail].toString().trim();
      const rowFullCourse = row[idxAppCourse].toString().trim(); // 예: "AI영상제작 기초 (1회차)"
      const rowStatus = row[idxAppStatus].toString().trim(); 
      const rowCourseBase = rowFullCourse.split(' (')[0].trim();

      // 이름, 이메일, 과정명이 일치하고 상태가 '취소'나 '반려'가 아닌 경우만 중복으로 간주
      if (rowName === applyName && rowEmail === applyEmail && rowCourseBase === applyCourseBase) {
        if (rowStatus !== '취소' && rowStatus !== '반려') {
          // 이미 신청한 회차 정보를 추출 (메시지용)
          const match = rowFullCourse.match(/\((.*?)회차\)/);
          duplicatedRound = match ? match[1] : "";
          return true;
        }
      }
      return false;
    });

    if (isDuplicate) {
      const errorMsg = duplicatedRound 
        ? `해당 교육의 ${duplicatedRound}회차를 이미 신청하셨습니다. 동일 교육의 타 회차 신청은 불가합니다. 자세한 사항은 신청 확인 메뉴를 이용해 주세요.`
        : "이미 해당 교육 과정에 신청하신 내역이 있습니다. 신청 확인 메뉴를 이용해 주세요.";
      
      return createJsonResponse({ 
        success: false, 
        error: errorMsg
      });
    }

    // [수정] 헤더 이름을 기준으로 동적으로 데이터 배열 생성
    const headers = sheet.getDataRange().getValues()[0].map(h => h.toString().trim());
    const newRow = new Array(headers.length).fill("");

    // 각 필드 매핑 로직 (헤더 이름 기준)
    const setVal = (name, val) => {
      const idx = headers.indexOf(name);
      if (idx !== -1) newRow[idx] = val;
    };

    setVal("신청일시", new Date());
    setVal("이름", data.name);
    setVal("연락처", "'" + data.phone);
    setVal("신청과정", data.course);
    setVal("Start Date", data.startDate || '');
    setVal("End Date", data.endDate || '');
    setVal("처리상태", '대기');
    setVal("이메일", data.email);
    setVal("회사명", data.company || '');
    setVal("부서/직급", data.position);
    setVal("재직여부", data.employment);
    setVal("주민등록번호", '');
    setVal("비고", '');
    setVal("취소사유", '');
    // '처리변환일시'는 초기값이므로 건너뜀

    sheet.appendRow(newRow);

    // --- 2. 신청 후 정원이 꽉 찼는지 다시 확인하여 자동 모집마감 처리 ---
    const finalEduSheet = getSheetCaseInsensitive(ss, 'Education');
    if (finalEduSheet) {
      const finalEduData = finalEduSheet.getDataRange().getValues();
      const finalHeaders = finalEduData[0];
      const fTitleIdx = finalHeaders.indexOf("Title");
      const fRoundIdx = finalHeaders.indexOf("회차");
      const fLimitIdx = finalHeaders.indexOf("정원");
      const fStatusIdx = finalHeaders.indexOf("Status");

      const rMatch = applyFullCourse.match(/\((.*?)회차\)/);
      const rNum = rMatch ? rMatch[1] : "";

      const fRowIdx = finalEduData.findIndex((r, idx) => {
        if (idx === 0) return false;
        return String(r[fTitleIdx]).trim() === applyCourseBase && 
               String(r[fRoundIdx]).trim().replace(/[^0-9]/g, '') === rNum;
      });

      if (fRowIdx !== -1) {
        const fLimit = parseInt(finalEduData[fRowIdx][fLimitIdx]) || 999;
        
        // [수정] 헤더 인덱스를 동적으로 사용하여 현재 신청 인원 카운트
        const fCount = sheet.getDataRange().getValues().filter((row, idx) => {
          if (idx === 0) return false;
          const rCourse = String(row[idxAppCourse]).trim();
          const rStatus = String(row[idxAppStatus]).trim();
          return rCourse === applyFullCourse && (rStatus === '대기' || rStatus === '승인');
        }).length;

        if (fCount >= fLimit && fStatusIdx !== -1) {
          finalEduSheet.getRange(fRowIdx + 1, fStatusIdx + 1).setValue('모집마감');
        }
      }
    }
    // ------------------------------------------------------------
    
    return createJsonResponse({ success: true, message: "신청이 성공적으로 접수되었습니다." });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  } finally {
    // 2. 잠금 해제 (반드시 실행)
    lock.releaseLock();
  }
}

/**
 * [추가] 이메일 발송 통합 함수
 */
function sendApplicationEmail(info) {
  const { name, email, course, status, reason, waitingNum } = info;
  
  // [추가] Education 시트에서 교육 정보 검색
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const eduSheet = ss.getSheetByName("Education");
  let eduInfo = { date: "추후 안내", location: "추후 안내" };

  if (eduSheet) {
    const eduData = eduSheet.getDataRange().getValues();
    const eduHeaders = eduData[0];
    const titleIdx = eduHeaders.indexOf("Title");
    const roundIdx = eduHeaders.indexOf("회차"); // Round -> 회차로 수정
    const startIdx = eduHeaders.indexOf("Start Date");
    const endIdx = eduHeaders.indexOf("End Date");
    const locIdx = eduHeaders.indexOf("Location");

    // 신청 데이터 예시: "AI영상제작 기초 (1회차)"
    // 시트 데이터 예시: Title="AI영상제작 기초", 회차="1"
    const row = eduData.find(r => {
      const sheetTitle = String(r[titleIdx]).trim();
      let sheetRound = String(r[roundIdx]).trim();
      
      // 혹시 시트의 "회차" 칸에 이미 "1회차"라고 적혀있을 경우를 대비해 숫자만 추출 시도
      const roundNumber = sheetRound.replace(/[^0-9]/g, ''); 
      const combinedTitle = `${sheetTitle} (${roundNumber || sheetRound}회차)`;
      
      return combinedTitle === course;
    });

    if (row) {
      const start = row[startIdx];
      const end = row[endIdx];
      const loc = row[locIdx];
      
      const formatDate = (d) => (d instanceof Date) ? Utilities.formatDate(d, "GMT+9", "yyyy.MM.dd") : d;
      
      if (start) {
        eduInfo.date = formatDate(start) + (end ? " ~ " + formatDate(end) : "");
      }
      if (loc) eduInfo.location = loc;
    }
  }

  let subject = `[SBS A&T] 교육 신청 ${status} 안내 - ${course}`;
  let body = "";

  const headerStyle = "style='color: #4f46e5; font-size: 1.2rem; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 20px;'";
  const boxStyle = "style='background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; line-height: 1.6;'";

  switch (status) {
    case '대기':
      subject = `[SBS A&T] 교육 신청이 정상적으로 접수되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>SBS A&T Hightech Platform 교육 신청이 정상적으로 접수되었습니다.</p>
        <div ${boxStyle}>
          <strong>신청 과정:</strong> ${course}<br>
          <strong>교육 일정:</strong> ${eduInfo.date}<br>
          <strong>교육 장소:</strong> ${eduInfo.location}<br>
          <strong>현재 상태:</strong> 신청 대기 (담당자 확인 중)
        </div>
        <p>담당자가 기재해주신 정보를 바탕으로 확인 후, 이메일을 통해 최종 승인 여부를 안내해 드릴 예정입니다.</p>
      `;
      break;
    case '승인':
      subject = `[SBS A&T] 교육 신청이 승인되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>신청하신 과정이 최종 <strong>승인</strong>되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>교육 일정:</strong> ${eduInfo.date}<br>
          <strong>교육 시간:</strong> 10:00 - 18:00<br>
          <strong>교육 장소:</strong> ${eduInfo.location}<br>
          <strong>상태:</strong> 승인 완료
        </div>
        <p>자세한 교육 참석 안내 사항은 추후 별도의 안내 메일을 드릴 예정입니다.<br> 신청하신 교육 참석이 어려울 시 haba98@sbs.co.kr로 즉시 알려주시길 바랍니다.</p>
      `;
      break;
    case '반려':
      subject = `[SBS A&T] 교육 신청 반려 안내 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>아쉽게도 해당 교육 과정의 신청이 <strong>반려</strong>되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>반려 사유:</strong> ${reason || '정원 초과 또는 요건 미충족'}
          <strong>문의:</strong> haba98@sbs.co.kr
        </div>
        <p>관련하여 문의사항이 있으시면 haba98@sbs.co.kr로 연락 주시기 바랍니다.</p>
      `;
      break;
    case '취소':
      subject = `[SBS A&T] 교육 신청이 취소되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>신청하신 교육 과정이 정상적으로 <strong>취소</strong> 처리되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>취소 사유:</strong> ${reason || '사용자 요청'}
        </div>
        <p>다음에 더 좋은 기회로 만나 뵙기를 바랍니다.</p>
      `;
      break;
    case '승인 대기':
      subject = `[SBS A&T] 교육 신청 승인 대기 안내 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>교육 신청이 <strong>승인 대기</strong> 상태로 전환되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>승인 대기:</strong> 정원 외 신청으로 취소 또는 결원 발생 시 순차적으로 승인 전환<br>
          ${waitingNum ? `<strong>대기 순번:</strong> ${waitingNum}번<br>` : ''}
          <strong>문의:</strong> haba98@sbs.co.kr
        </div>
        <p>본 과정은 선착순 정원 외 신청으로, 기존 승인 인원 중 <strong>결원 발생 시</strong> 순차적으로 최종 승인 처리될 예정입니다.</p>
        <p>최종 승인 여부는 추후 다시 안내해 드리겠습니다. 기다려 주셔서 감사합니다.</p>
      `;
      break;
  }

  const footer = `
    <div style="margin-top: 30px; font-size: 0.85rem; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 10px;">
      본 메일은 발신 전용입니다. 문의는 haba98@sbs.co.kr로 연락 주시기 바랍니다.<br>
      © SBS A&T Hightech Platform. All rights reserved.
    </div>
  `;

  try {
    GmailApp.sendEmail(email, subject, "", {
      name: "SBS A&T 교육팀",
      htmlBody: body + footer
    });
  } catch (e) {
    console.error("Email sending failed:", e.toString());
  }
}

/**
 * [추가] 관리자가 시트에서 직접 '처리상태'를 변경할 때 이메일 발송
 * (반드시 '수정 시' 실행되는 설치 가능한 트리거 설정을 해야 함)
 */
function onEditTrigger(e) {
  const range = e.range;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();
  
  // 'Applications' 시트이고, 7번째 열(처리상태)이 수정된 경우만 작동
  if (sheetName === 'Applications' && range.getColumn() === 7 && range.getRow() > 1) {
    const rowIndex = range.getRow();
    const fullData = sheet.getDataRange().getValues();
    const headers = fullData[0];
    const rowData = fullData[rowIndex - 1];
    
    // 헤더 이름을 기준으로 인덱스 찾기 (유연한 대응)
    const idxStatus = headers.indexOf("처리상태");
    const idxName = headers.indexOf("이름");
    const idxCourse = headers.indexOf("신청과정");
    const idxEmail = headers.indexOf("이메일");
    const idxNote = headers.indexOf("비고"); 
    const idxCancelReason = headers.indexOf("취소사유");
    const idxWaitingNum = headers.indexOf("대기번호");
    const idxStatusModified = headers.indexOf("처리변환일시");

    const status = rowData[idxStatus]; 
    const name = rowData[idxName];   
    const course = rowData[idxCourse]; 
    const email = rowData[idxEmail];  
    const note = idxNote !== -1 ? rowData[idxNote] : "";
    const cancelReason = idxCancelReason !== -1 ? rowData[idxCancelReason] : "";
    const waitingNum = idxWaitingNum !== -1 ? rowData[idxWaitingNum] : "";

    // 상태가 변경되었고, 새로운 상태 값이 비어있지 않은 경우에만 처리
    if (status && e.oldValue !== status) {
      // 1. 처리변환일시 기록
      if (idxStatusModified !== -1) {
        sheet.getRange(rowIndex, idxStatusModified + 1).setValue(new Date());
      }

      // 2. 이메일 발송
      const reasonToSend = (status === '취소' || status === '반려') ? cancelReason : note;
      sendApplicationEmail({
        name: name,
        email: email,
        course: course,
        status: status,
        reason: reasonToSend,
        waitingNum: waitingNum 
      });
    }
  }
}

/**
 * [관리용] 'Education' 시트의 데이터를 구글 캘린더와 동기화하는 함수 (버튼용)
 * 누가 버튼을 누르든 항상 '나(관리자)'의 권한으로 실행되는 웹 앱 URL을 호출합니다.
 */
function syncSheetToCalendar() {
  const ui = (function() { try { return SpreadsheetApp.getUi(); } catch(e) { return null; } })();
  
  try {
    // 1. 직접 실행 시도
    syncSheetToCalendarInternal();
    if (ui) ui.alert("✅ 동기화가 완료되었습니다.");
    
  } catch (e) {
    const errorMsg = e.toString();
    // 2. 권한 부족(타 계정) 시 웹 앱 API 호출
    if (errorMsg.includes("허용되지 않는 작업") || errorMsg.includes("Permission denied") || errorMsg.includes("접근 권한")) {
      try {
        const url = ScriptApp.getService().getUrl();
        if (!url) {
          if (ui) ui.alert("❌ 웹 앱이 배포되지 않았습니다. [배포 > 새 배포]를 먼저 완료해 주세요.");
          return;
        }

        // 관리자 권한으로 실행되는 본인의 Web App 호출
        const response = UrlFetchApp.fetch(url + "?type=SyncCalendar", {
          muteHttpExceptions: true,
          followRedirects: true
        });
        
        console.log("자동 동기화 요청 결과:", response.getContentText());
        
        if (ui) {
          ui.alert("✅ 관리자 계정의 권한으로 동기화를 요청했습니다.\n잠시 후(약 10~30초 뒤) 캘린더를 확인해 보세요.");
        }
      } catch (fetchError) {
        console.error("API 호출 실패:", fetchError);
        if (ui) ui.alert("❌ API 호출 중 오류가 발생했습니다: " + fetchError.toString());
      }
    } else {
      console.error("동기화 로직 오류:", e);
      if (ui) ui.alert("❌ 오류 발생: " + e.toString());
    }
  }
}

/**
 * 실제 동기화 로직을 수행하는 내부 함수
 */
function syncSheetToCalendarInternal() {
  const calendarId = "sbskhpdev@gmail.com";
  const calendar = CalendarApp.getCalendarById(calendarId);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Education");
  
  if (!sheet) {
    console.error("❌ 'Education' 시트 탭을 찾을 수 없습니다.");
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);
  
  // 컬럼 인덱스 찾기
  const idx = {
    title: headers.indexOf("Title"),
    start: headers.indexOf("Start Date"),
    end: headers.indexOf("End Date"),
    desc: headers.indexOf("Description"),
    loc: headers.indexOf("Location"),
    id: headers.indexOf("Event ID"),
    status: headers.indexOf("Status")
  };

  rows.forEach((row, rowIndex) => {
    const title = row[idx.title];
    
    // 날짜 파싱 개선: 마침표(.) 형식을 하이픈(-)으로 변환하여 인식률 제고
    const parseDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return val;
      const dateStr = String(val).replace(/\./g, '-').replace(/\s+/g, '').trim();
      return new Date(dateStr);
    };

    const startTime = parseDate(row[idx.start]);
    const endTime = parseDate(row[idx.end]) || startTime;
    
    const description = row[idx.desc];
    const location = row[idx.loc];
    const eventId = row[idx.id];
    const status = row[idx.status];
    
    if (!title || !startTime || isNaN(startTime.getTime())) return;

    // 제목에 상태 추가 (예: [모집중] 제목)
    const fullTitle = status ? `[${status}] ${title}` : title;

    // 시간이 없으면(00:00) 종일 일정으로 처리
    const isAllDay = (startTime.getHours() === 0 && startTime.getMinutes() === 0 && 
                      endTime.getHours() === 0 && endTime.getMinutes() === 0);

    let event;
    try {
      if (eventId) {
        event = calendar.getEventById(eventId);
      }
    } catch (e) {
      console.log("Event not found, creating new one.");
    }

    // 일정 옵션 설정
    const options = {
      description: description,
      location: location
    };

    // [수정] 차단 방지를 위해 변경사항이 있을 때만 API 호출
    let isChanged = false;
    if (event) {
      const oldTitle = event.getTitle();
      const oldDesc = event.getDescription();
      const oldLoc = event.getLocation();
      
      if (oldTitle !== fullTitle || oldDesc !== (description || "") || oldLoc !== (location || "")) {
        isChanged = true;
      }
    } else {
      isChanged = true;
    }

    if (isChanged) {
      if (event) {
        // 기존 일정 수정
        event.setTitle(fullTitle);
        event.setDescription(description);
        event.setLocation(location);
        
        if (isAllDay) {
          const end = new Date(endTime);
          end.setDate(end.getDate() + 1);
          event.setAllDayDates(startTime, end);
        } else {
          event.setTime(startTime, endTime);
        }
      } else {
        // 새 일정 생성
        if (isAllDay) {
          const end = new Date(endTime);
          end.setDate(end.getDate() + 1);
          event = calendar.createAllDayEvent(fullTitle, startTime, end, options);
        } else {
          event = calendar.createEvent(fullTitle, startTime, endTime, options);
        }
        sheet.getRange(rowIndex + 2, idx.id + 1).setValue(event.getId());
      }

      // 상태에 따른 색상 변경
      if (status === "모집중") {
        event.setColor(CalendarApp.EventColor.PALE_GREEN);
      } else if (status === "마감" || status === "모집마감") {
        event.setColor(CalendarApp.EventColor.GRAY);
      } else if (status === "모집예정") {
        event.setColor(CalendarApp.EventColor.PALE_BLUE);
      } else if (status === "폐강") {
        event.setColor(CalendarApp.EventColor.RED);
      }
      
      // 구글 서버에 너무 잦은 요청을 보내지 않도록 짧은 대기 시간 추가 (0.5초)
      Utilities.sleep(500);
    }
  });
  
  console.log("캘린더 동기화가 완료되었습니다.");
}
