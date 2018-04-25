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
  saveBills(bills,
            fields,
            {
              identifiers: ['bipandgo'],
              contentType: 'application/pdf'
            })
}

function parsePage($) {
  const bills = scrape($,
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
                   parse: str => parseFloat(str.replace(',','.'))
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
  return bills.map(bill => {
    return {
        ...bill,
      vendor: 'bipandgo',
      currency: '€',
      filename: `${bill['billDate'].format('YYYY-MM-DD')}` +
        `_${bill['amountString']}_${bill['billId']}.pdf`
      delete bill.billDate
      delete bill.amountString
    }
  })
}


async function getPage(pageId) {
  log('info', `Fetching page ${pageId}`)
  const $ = await request({
    method: 'POST',
    url: `${accountUrl}/operation-My.Account`,
    formData: {
      // Mandatory for page change
      'order_listbox_list_selection_name': 'WebSection_viewAccountInformation_order_listbox_selection',
      'order_listbox_uid:list': '0',  // dummy value
      'listbox_nextPage:method': 'order_listbox',
      'order_listbox_page_start': `${pageId - 1 }`,
      // Mandatory for viewing bills tab in html
      'form_id': 'WebSection_viewAccountInformation',
      'list_selection_name': 'WebSection_viewAccountInformation_account_listbox_selection',
      'service_listbox_uid:list': ''
    }
  })
  pageReturned = $('input[name=order_listbox_page_start]').val()
  if (pageReturned != pageId) {
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
      bills = bills.concat(parsePage($))
      page = page + 1
    }
    else {
      again = false
      continue
    }
  }
  return bills
}

//TODO Redondance await
//TODO ERROrs
async function login(fields) {
  await signin({
    url: `${baseUrl}/login_form`,
    formSelector: '.main_form',
    formData: {
      __ac_name: fields.login,
      __ac_password: fields.password },
    validate: (statusCode, $) => statusCode === 200
  })
}
