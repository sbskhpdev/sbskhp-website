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
      
      // 이름(Index 1)과 이메일(Index 7)로 검색
      const found = rows.filter(row => 
        row[1].toString().trim() === name && 
        row[7].toString().trim() === email
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
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheetCaseInsensitive(ss, 'Applications');
    
    if (!sheet) return createJsonResponse({ error: "Applications sheet not found" });

    const data = JSON.parse(e.postData.contents);
    const type = (data.type || 'Apply').trim();

    // [취소 처리 로직]
    if (type === 'Cancel') {
      const allData = sheet.getDataRange().getValues();
      let foundRowIndex = -1;

      const searchName = (data.name || "").trim();
      const searchEmail = (data.email || "").trim();
      const searchCourse = (data.course || "").trim();

      // 이름, 이메일, 신청과정으로 행 찾기
      for (let i = 1; i < allData.length; i++) {
        if (allData[i][1].toString().trim() === searchName && 
            allData[i][7].toString().trim() === searchEmail && 
            allData[i][3].toString().trim() === searchCourse) {
          foundRowIndex = i + 1; // 1-based index
          break;
        }
      }

      if (foundRowIndex > 0) {
        sheet.getRange(foundRowIndex, 7).setValue('취소'); // 처리상태 (7번째 열)
        sheet.getRange(foundRowIndex, 14).setValue(data.cancelReason || '사용자 요청 취소'); // 취소사유 (14번째 열)
        
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
    const applyName = (data.name || "").trim();
    const applyEmail = (data.email || "").trim();
    const applyCourse = (data.course || "").trim();

    const isDuplicate = existingData.some(row => 
      row[1].toString().trim() === applyName && 
      row[7].toString().trim() === applyEmail && 
      row[3].toString().trim() === applyCourse
    );

    if (isDuplicate) {
      return createJsonResponse({ 
        success: false, 
        error: "신청 확인 메뉴를 이용해 주세요. 이미 해당 교육 과정에 신청하신 내역이 있습니다." 
      });
    }

    // 새 헤더 순서대로 데이터 배열 생성
    // [신청일시(1), 이름(2), 연락처(3), 신청과정(4), Start Date(5), End Date(6), 처리상태(7), 이메일(8), 회사명(9), 부서/직급(10), 재직여부(11), 주민등록번호(12), 비고(13), 취소사유(14)]
    const newRow = [
      new Date(), // 신청일시
      data.name,
      "'" + data.phone, // 연락처
      data.course,
      data.startDate || '',
      data.endDate || '',
      '대기', // 처리상태
      data.email,
      data.company || '',
      data.position,
      data.employment,
      '', // 주민등록번호 (필요 시 수집 가능)
      '', // 비고
      ''  // 취소사유
    ];

    sheet.appendRow(newRow);
    
    // [추가] 신청 완료 안내 이메일 발송
    sendApplicationEmail({
      name: data.name,
      email: data.email,
      course: data.course,
      status: '대기'
    });

    return createJsonResponse({ success: true, message: "신청이 성공적으로 접수되었습니다." });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  }
}

/**
 * [추가] 이메일 발송 통합 함수
 */
function sendApplicationEmail(info) {
  const { name, email, course, status, reason } = info;
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
          <strong>현재 상태:</strong> 신청 대기 (담당자 확인 중)
        </div>
        <p>담당자가 기재해주신 정보를 바탕으로 확인 후, 이메일을 통해 최종 승인 여부를 안내해 드릴 예정입니다.</p>
      `;
      break;
    case '승인':
      subject = `[SBS A&T] 축하합니다! 교육 신청이 승인되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>과정 참여 신청이 최종 <strong>승인</strong>되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>상태:</strong> 승인 완료
        </div>
        <p>교육 장소 및 세부 준비물에 대해서는 추후 별도의 안내 메일을 드릴 예정입니다. 교육 당일 늦지 않게 참석 부탁드립니다.</p>
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
    const rowData = sheet.getRange(rowIndex, 1, 1, 14).getValues()[0];
    
    const status = rowData[6]; // 처리상태 (Index 6)
    const name = rowData[1];   // 이름 (Index 1)
    const course = rowData[3]; // 신청과정 (Index 3)
    const email = rowData[7];  // 이메일 (Index 7)
    const reason = rowData[13]; // 취소사유/비고 (Index 13)

    // 상태가 변경되었을 때만 발송 (기존 값과 다른 경우)
    if (e.oldValue !== status) {
      sendApplicationEmail({
        name: name,
        email: email,
        course: course,
        status: status,
        reason: reason
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
