import smartpy as sp

class Escrow(sp.Contract):
    def __init__(self):
        self.init(m = sp.big_map({}, tkey=sp.TAddress, tvalue=sp.TMutez))

    def verify_pending_transaction(self, sender):
        sp.verify(self.data.m.contains(sender), message = "no pending transaction")

    @sp.entry_point
    def add_funds(self):
        sp.verify(sp.amount > sp.tez(0))
        sp.verify(~self.data.m.contains(sp.sender), message = "pending transaction")
        self.data.m[sp.sender] = sp.amount
    
    @sp.entry_point
    def pull_funds(self):
        self.verify_pending_transaction(sp.sender)
        sp.send(sp.sender, self.data.m[sp.sender])
        del self.data.m[sp.sender]

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
    def redeem_funds(self, params):
        sp.set_type(params.to, sp.TAddress)
        sp.set_type(params.ids, sp.TList(sp.TNat))
        sp.set_type(params.amount, sp.TMutez)
        sp.verify(sp.sender == self.data.administrator)
        self.verify_pending_transaction(params.to)
        amount = sp.local('amount', self.data.m[params.to])
        sp.verify(amount.value == params.amount, message = "amount mismatch")
        sp.send(self.data.administrator, amount.value)
        self.fa2_transfer(self.data.fa2, sp.sender, params.to, params.ids)
        del self.data.m[params.to]

class FA2(sp.Contract):
    def __init__(self):
        self.init()

    @sp.entry_point
    def transfer(self, params):
        sp.set_type(params, sp.TList(sp.TRecord(from_=sp.TAddress, txs=sp.TList(sp.TRecord(amount=sp.TNat, to_=sp.TAddress, token_id=sp.TNat).layout(("to_", ("token_id", "amount"))))).layout(("from_", "txs"))))
        pass

@sp.add_test(name = "Marketplace")
def test():
    s = sp.test_scenario()

    s.h1("Escrow")
    c = Escrow()
    s += c

    admin = sp.test_account("Administrator")
    alice = sp.test_account("Alice")
    bob   = sp.test_account("Robert")
    s.show([admin, alice, bob])

    c.add_funds().run(sender = alice, valid = False)
    c.add_funds().run(sender = alice, amount = sp.tez(5))
    c.add_funds().run(sender = alice, amount = sp.tez(1), valid = False)
    c.pull_funds().run(sender = bob, valid = False)
    c.pull_funds().run(sender = alice)
    s.verify(c.balance == sp.tez(0))

    fa2 = FA2()
    s += fa2

    s.h1("Marketplace")
    c = Marketplace(fa2.address, admin.address)
    s += c
    ids = [1, 2, 3]
    c.add_funds().run(sender = alice, amount = sp.tez(1))
    c.redeem_funds(ids = ids, to = alice.address, amount = sp.tez(1)).run(sender = alice, valid = False)
    c.redeem_funds(ids = ids, to =   bob.address, amount = sp.tez(1)).run(sender = admin, valid = False)
    c.redeem_funds(ids = ids, to = alice.address, amount = sp.tez(0)).run(sender = admin, valid = False)
    c.redeem_funds(ids = ids, to = alice.address, amount = sp.tez(5)).run(sender = admin, valid = False)
    c.redeem_funds(ids = ids, to = alice.address, amount = sp.tez(1)).run(sender = admin)
    s.verify(c.balance == sp.tez(0))

@sp.add_test(name = "Deploy")
def deploy():
    s = sp.test_scenario()
    s.h1("Deploy")
    fa2Contract = sp.address("KT1N1a7TA1rEedQo2pEQXhuVgSQNvgRWKkdJ")
    adminAddress = sp.address("tz1Qej2aPmeZECBZHV5meTLC1X6DWRhSCoY4")
    c = Marketplace(fa2Contract, adminAddress)
    s += c