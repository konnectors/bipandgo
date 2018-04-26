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
const accountUrl = baseUrl + '/mon_compte/situation'

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
  log('info', 'Scraping and prefetching bills')
  let bills = scrape(
    $,
    {
      billDate: {
        sel: 'td:nth-child(1)',
        parse: str => moment(str, 'L')
      },
      date: {
        sel: 'td:nth-child(2)',
        parse: str => moment(str, 'L').toDate()
      },
      billId: {
        sel: 'td:nth-child(3)'
      },
      amount: {
        sel: 'td:nth-child(4)',
        parse: str => parseFloat(str.replace(',', '.'))
      },
      amountString: {
        sel: 'td:nth-child(4)',
        parse: str => `${str}€`
      },
      fileurl: {
        sel: 'td:nth-child(5) a',
        attr: 'href',
        parse: href => `${accountUrl}/operation-My.Account/${href}`
      }
    },
    'table.order_listbox-table tbody tr'
  )
  // TODO av chris , non retour d'une promesse
  bills = await preFetchAndFilter(bills)
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

async function preFetchAndFilter(bills) {
  // We will prefetch bills and erase which ones return a 500
  // Seen for bills before Oct-2013 in tested account
  let billsNew = []
  for (let i = 0; i < bills.length; i += 1) {
    let addit = true
    try {
      await request(bills[i].fileurl)
    } catch (err) {
      if (err.statusCode === 500) {
        log('info', `Bill not available for ${bills[i].date}`)
        addit = false
      } else throw err
    }
    if (addit) {
      billsNew.push(bills[i])
    } else {
      log('debug', `Remove bill ${bills[i].date}`)
    }
  }
  return billsNew
}

async function getPage(pageId) {
  log('info', `Fetching page ${pageId}`)
  const $ = await request({
    method: 'POST',
    url: `${accountUrl}/operation-My.Account`,
    formData: {
      // Mandatory for page change
      order_listbox_list_selection_name:
        'WebSection_viewAccountInformation_order_listbox_selection',
      'order_listbox_uid:list': '0', // dummy value
      'listbox_nextPage:method': 'order_listbox',
      order_listbox_page_start: `${pageId - 1}`,
      // Mandatory for viewing bills tab in html
      form_id: 'WebSection_viewAccountInformation',
      list_selection_name:
        'WebSection_viewAccountInformation_account_listbox_selection',
      'service_listbox_uid:list': ''
    }
  })
  if ($('input[name=order_listbox_page_start]').val() != pageId) {
    log('info', `Page ${pageId} not found, expecting no more page`)
    // Page return is the max page, can't fetch asked page.
    return null
  } else {
    log('debug', `Page ${pageId} found`)
    return $
  }
}

async function getBillsList() {
  let bills = []
  let again = true
  let page = 1
  let $
  while (again) {
    $ = await getPage(page)
    if ($ != null) {
      const partBill = await parsePage($)
      bills = bills.concat(partBill)
      page = page + 1
    } else {
      again = false
      continue
    }
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
  await request(accountUrl).catch(err => {
    if (err.statusCode === 401) throw new Error(errors.LOGIN_FAILED)
    else throw err
  })
}
