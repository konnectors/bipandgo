process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://fd8eff36bc174135b11022c87665aab5:de67cf86d0f742e4b00c351f82260d17@sentry.cozycloud.cc/41'

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log,
  errors
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  //  debug: true,
  jar: true
})
const moment = require('moment')
moment.locale('fr')

const baseUrl = 'https://www.bipandgo.com'
const billsUrl = baseUrl + '/mon_compte/factures/site2017-mon_compte-factures'

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login(fields)
  const bills = await getBillsList()
  await saveBills(bills, fields, {
    identifiers: ['bipandgo'],
    contentType: 'application/pdf'
  })
}

async function parsePage($) {
  log('info', 'Scraping and filter bills')
  let bills = scrape(
    $,
    {
      billId: {
        sel: 'td:nth-child(1)'
      },

      billDate: {
        sel: 'td:nth-child(2)',
        parse: str => moment(str, 'L')
      },
      date: {
        sel: 'td:nth-child(2)',
        parse: str => moment(str, 'L').toDate()
      },
      amount: {
        sel: 'td:nth-child(4)',
        parse: str => parseFloat(str.replace(',', '.'))
      },
      amountString: {
        sel: 'td:nth-child(4)',
        parse: str => `${str}`
      },
      fileurl: {
        sel: 'td:nth-child(4) a',
        attr: 'href',
        parse: href => `${billsUrl}/${href}`
      }
    },
    'tbody.badges-block__table-body tr'
  )
  bills = await filter(bills)
  return bills.map(bill => {
    const filename =
      `${bill['billDate'].format('YYYY-MM-DD')}` +
      `_${bill['amountString']}_${bill['billId']}.pdf`
    delete bill.billDate
    delete bill.amountString
    return {
      ...bill,
      vendor: 'bipandgo',
      currency: '€',
      filename: filename
    }
  })
}

async function filter(bills) {
  // We remove old bills that don't have a link to a pdf
  let billsNew = []
  for (let i = 0; i < bills.length; i += 1) {
    if (bills[i].fileurl === `${billsUrl}/undefined`) {
      log('debug', 'Discard an old bill without pdf')
    } else {
      billsNew.push(bills[i])
    }
  }
  return billsNew
}

async function getPage(pageId) {
  log('info', `Fetching page ${pageId}`)
  const $ = await request({
    method: 'POST',
    url: `${billsUrl}`,
    formData: {
      invoice_listbox_page_start: `${pageId}`,
      dialog_id: 'WebSection_viewInvoiceInformation',
      'invoice_listbox_uid:list': '',
      invoice_listbox_list_selection_name:
        'WebSection_viewInvoiceInformation_invoice_listbox_selection',
      'listbox_setPage:method': 'invoice_listbox'
    }
  })
  if ($('a.pagination__next').hasClass('visually-hidden')) {
    log('info', `Next page link not found, expecting no more page`)
    return { page: $, status: false }
  } else {
    log('debug', `Page ${pageId} found`)
    return { page: $, status: true }
  }
}

async function getBillsList() {
  let bills = []
  let again = true
  let page = 1
  while (again) {
    const pageAndStatus = await getPage(page)
    again = pageAndStatus.status
    const partBill = await parsePage(pageAndStatus.page)
    bills = bills.concat(partBill)
    page = page + 1
  }
  return bills
}

async function login(fields) {
  log('info', 'Logging...')
  await signin({
    url: `${baseUrl}/login_form`,
    formSelector: '.main_form',
    formData: {
      __ac_name: fields.login,
      __ac_password: fields.password
    }
  })
  // Make a check, because resp to signin is identical(except SERVERID cookie)
  await request(billsUrl).catch(err => {
    if (err.statusCode === 401) throw new Error(errors.LOGIN_FAILED)
    else throw err
  })
}
