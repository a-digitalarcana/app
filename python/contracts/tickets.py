import smartpy as sp

class Escrow(sp.Contract):
    def __init__(self):
        self.init(tickets = sp.big_map({}, tkey=sp.TAddress, tvalue=sp.TTicket(sp.TMutez)))

    @sp.entry_point
    def purchase_ticket(self):
        sp.verify(sp.amount > sp.tez(0))
        with sp.modify_record(self.data, "data") as data:
            ticket = sp.ticket(sp.amount, 1)
            (ticket, tickets) = sp.get_and_update(data.tickets, sp.sender, sp.some(ticket))
            data.tickets = tickets
            sp.verify(~ticket.is_some(), message = "pending transaction")
    
    @sp.entry_point
    def refund_ticket(self):
        with sp.modify_record(self.data, "data") as data:
            (ticket, tickets) = sp.get_and_update(data.tickets, sp.sender)
            data.tickets = tickets
            read_ticket = sp.read_ticket(ticket.open_some())
            # sp.verify(read_ticket.ticketer == self.address)
            sp.send(sp.sender, read_ticket.content)

class Marketplace(Escrow):
    def __init__(self, fa2, admin):
        Escrow.__init__(self)
        self.update_initial_storage(fa2 = fa2, administrator = admin)

    def fa2_transfer(self, fa2, from_, to_, ids):
        txs_type = sp.TRecord(amount=sp.TNat, to_=sp.TAddress, token_id=sp.TNat).layout(("to_", ("token_id", "amount")))
        c = sp.contract(sp.TList(sp.TRecord(from_=sp.TAddress, txs=sp.TList(txs_type))), fa2, entry_point='transfer').open_some()
        txs = sp.local('txs', sp.list(t=txs_type))
        sp.for id in ids:
            txs.value.push(sp.record(amount=1, to_=to_, token_id=id))
        sp.transfer(sp.list([sp.record(from_=from_, txs=txs.value)]), sp.mutez(0), c)

    @sp.entry_point
    def redeem_ticket(self, params):
        sp.set_type(params.to, sp.TAddress)
        sp.set_type(params.ids, sp.TList(sp.TNat))
        sp.set_type(params.amount, sp.TMutez)
        with sp.modify_record(self.data, "data") as data:
            sp.verify(sp.sender == data.administrator)
            (ticket, tickets) = sp.get_and_update(data.tickets, params.to)
            data.tickets = tickets
            read_ticket = sp.read_ticket(ticket.open_some())
            # sp.verify(read_ticket.ticketer == self.address)
            sp.verify(read_ticket.content == params.amount, message = "amount mismatch")
            sp.send(data.administrator, read_ticket.content)
            self.fa2_transfer(data.fa2, sp.sender, params.to, params.ids)

class FA2(sp.Contract):
    def __init__(self):
        self.init()

    @sp.entry_point
    def transfer(self, params):
        sp.set_type(params, sp.TList(sp.TRecord(from_=sp.TAddress, txs=sp.TList(sp.TRecord(amount=sp.TNat, to_=sp.TAddress, token_id=sp.TNat).layout(("to_", ("token_id", "amount"))))).layout(("from_", "txs"))))
        pass

@sp.add_test(name = "Marketplace")
def test():
    c = Escrow()
    s = sp.test_scenario()
    s += c

    admin = sp.test_account("Administrator")
    alice = sp.test_account("Alice")
    bob   = sp.test_account("Robert")
    s.show([admin, alice, bob])

    c.purchase_ticket().run(sender = alice, valid = False)
    c.purchase_ticket().run(sender = alice, amount = sp.tez(5))
    c.purchase_ticket().run(sender = alice, amount = sp.tez(1), valid = False)
    c.refund_ticket().run(sender = bob, valid = False)
    c.refund_ticket().run(sender = alice)
    s.verify(c.balance == sp.tez(0))

    fa2 = FA2()
    s += fa2

    c = Marketplace(fa2.address, admin.address)
    s += c
    ids = [1, 2, 3]
    c.purchase_ticket().run(sender = alice, amount = sp.tez(1))
    c.redeem_ticket(ids = ids, to = alice.address, amount = sp.tez(1)).run(sender = alice, valid = False)
    c.redeem_ticket(ids = ids, to =   bob.address, amount = sp.tez(1)).run(sender = admin, valid = False)
    c.redeem_ticket(ids = ids, to = alice.address, amount = sp.tez(0)).run(sender = admin, valid = False)
    c.redeem_ticket(ids = ids, to = alice.address, amount = sp.tez(5)).run(sender = admin, valid = False)
    c.redeem_ticket(ids = ids, to = alice.address, amount = sp.tez(1)).run(sender = admin)
    s.verify(c.balance == sp.tez(0))